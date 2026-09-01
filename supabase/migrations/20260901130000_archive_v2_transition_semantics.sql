-- Archive v2 transition RPCs: atomic merge, revert, and branch reinitialize.

create or replace function public.commit_archive_merge_v2(
  p_archive_request_id uuid,
  p_merged_by uuid,
  p_closing_comment jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.workspace_archive_requests%rowtype;
  submission_row public.submissions%rowtype;
  source_row public.archive_source_revisions%rowtype;
  branch_row public.archive_branches%rowtype;
  version_row public.archive_versions%rowtype;
  map_revision_row public.archive_map_revisions%rowtype;
  branch_key text := trim(coalesce(p_payload->>'branchKey', ''));
  submission_type text := trim(coalesce(p_payload->>'submissionType', ''));
  payload_release_id text := trim(coalesce(p_payload->>'releaseId', ''));
  primary_dguid text := trim(coalesce(p_payload->>'primaryDguid', ''));
  secondary_dguid text := nullif(trim(coalesce(p_payload->>'secondaryDguid', '')), '');
  scope_pruids text[] := coalesce(
  (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(p_payload->'scopePruids', '[]'::jsonb)) as value),
  '{}'::text[]
);
  next_version_number integer;
  cp_payload jsonb := coalesce(p_payload->'counterProposal', 'null'::jsonb);
  affected_dguid text;
  head_row public.archive_map_da_heads%rowtype;
  current_map_revision bigint;
begin
  if branch_key = '' or payload_release_id = '' or primary_dguid = '' then
    raise exception 'archive merge payload is incomplete' using errcode = '22023';
  end if;
  if submission_type not in ('comment', 'objection', 'counter_proposal') then
    raise exception 'unsupported archive submission type' using errcode = '22023';
  end if;

  select * into request_row
  from public.workspace_archive_requests
  where id = p_archive_request_id
  for update;
  if not found then
    raise exception 'archive request not found' using errcode = 'P0002';
  end if;
  if request_row.state <> 'approved' then
    raise exception 'archive request is not approved' using errcode = 'P0001', message = 'ARCHIVE_REQUEST_NOT_APPROVED';
  end if;

  select * into submission_row
  from public.submissions
  where id = request_row.submission_id
  for update;
  if not found then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;

  select * into source_row
  from public.archive_source_revisions
  where id = request_row.source_revision_id;
  if not found then
    raise exception 'sealed archive source is missing' using errcode = 'P0001', message = 'ARCHIVE_SOURCE_MISSING';
  end if;

  insert into public.archive_branches (
    branch_key, submission_type, release_id, primary_dguid, secondary_dguid, scope_pruids
  ) values (
    branch_key, submission_type, payload_release_id, primary_dguid, secondary_dguid, scope_pruids
  )
  on conflict (branch_key) do update
    set updated_at = now()
  returning * into branch_row;

  select coalesce(max(version_number), 0) + 1
  into next_version_number
  from public.archive_versions
  where branch_id = branch_row.id;

  insert into public.archive_versions (
    branch_id,
    version_number,
    version_kind,
    source_submission_id,
    source_geometry_revision_id,
    submission_projection,
    branch_vertex_snapshot,
    result_geometry,
    display_geometry,
    geometry_digest,
    validation_report,
    closing_comment,
    merged_by,
    merged_at
  ) values (
    branch_row.id,
    next_version_number,
    'merge',
    submission_row.id,
    nullif(p_payload->>'sourceGeometryRevisionId', '')::uuid,
    coalesce(p_payload->'submissionProjection', '{}'::jsonb),
    case when submission_type = 'counter_proposal' then cp_payload->'branchVertexSnapshot' else null end,
    case when submission_type = 'counter_proposal' then cp_payload->'resultGeometry' else null end,
    case when submission_type = 'counter_proposal' then cp_payload->'displayGeometry' else null end,
    nullif(cp_payload->>'geometryDigest', ''),
    coalesce(cp_payload->'validationReport', '{}'::jsonb),
    p_closing_comment,
    p_merged_by,
    now()
  )
  returning * into version_row;

  if submission_type = 'counter_proposal' then
  select coalesce(max(sequence), 0) into current_map_revision
  from public.archive_map_revisions
  where archive_map_revisions.release_id = payload_release_id;
  if current_map_revision <> coalesce((cp_payload->>'expectedMapRevision')::bigint, current_map_revision) then
    raise exception 'archived map is stale' using errcode = 'P0001', message = 'STALE_ARCHIVE_MAP';
  end if;

  insert into public.archive_version_operations (
    archive_version_id, operation_index, vertex_id,
    from_lng, from_lat, to_lng, to_lat, source_submission_operation_index
  )
  select
    version_row.id,
    (operation->>'operation_index')::integer,
    operation->>'vertex_id',
    (operation->>'from_lng')::double precision,
    (operation->>'from_lat')::double precision,
    (operation->>'to_lng')::double precision,
    (operation->>'to_lat')::double precision,
    nullif(operation->>'source_submission_operation_index', '')::integer
  from jsonb_array_elements(coalesce(cp_payload->'operations', '[]'::jsonb)) as operation;

  insert into public.archive_vertex_state (
    branch_id, vertex_id, lng, lat, last_merge_sequence, last_version_id, source_submission_id
  )
  select
    branch_row.id,
    operation->>'vertex_id',
    (operation->>'to_lng')::double precision,
    (operation->>'to_lat')::double precision,
    version_row.merge_sequence,
    version_row.id,
    submission_row.id
  from jsonb_array_elements(coalesce(cp_payload->'operations', '[]'::jsonb)) as operation
  on conflict (branch_id, vertex_id) do update set
    lng = excluded.lng,
    lat = excluded.lat,
    last_merge_sequence = excluded.last_merge_sequence,
    last_version_id = excluded.last_version_id,
    source_submission_id = excluded.source_submission_id;

  for affected_dguid in
    select jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb))
  loop
    insert into public.archive_map_da_heads (
      release_id, dguid, uses_base, geometry, display_geometry, geometry_digest,
      resource_version, last_map_revision_sequence
    ) values (
      payload_release_id,
      affected_dguid,
      coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false),
      case
        when coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false) then null
        else cp_payload->'headGeometry'->affected_dguid
      end,
      case
        when coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false) then null
        else cp_payload->'headDisplayGeometry'->affected_dguid
      end,
      cp_payload->'afterDigests'->>affected_dguid,
      1,
      0
    )
    on conflict (release_id, dguid) do update set
      uses_base = excluded.uses_base,
      geometry = excluded.geometry,
      display_geometry = excluded.display_geometry,
      geometry_digest = excluded.geometry_digest,
      resource_version = public.archive_map_da_heads.resource_version + 1,
      last_map_revision_sequence = excluded.last_map_revision_sequence,
      last_archive_version_id = version_row.id,
      updated_at = now();
  end loop;

  insert into public.archive_map_revisions (
    release_id,
    source_archive_version_id,
    source_branch_key,
    source_submission_ids,
    transition_kind,
    affected_dguids,
    before_digests,
    after_digests,
    created_by
  ) values (
    payload_release_id,
    version_row.id,
    branch_key,
    array[submission_row.id],
    'merge',
    coalesce(
      (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb)) as value),
      '{}'::text[]
    ),
    coalesce(cp_payload->'beforeDigests', '{}'::jsonb),
    coalesce(cp_payload->'afterDigests', '{}'::jsonb),
    p_merged_by
  )
  returning * into map_revision_row;

  update public.archive_map_da_heads
  set last_map_revision_sequence = map_revision_row.sequence
  where archive_map_da_heads.release_id = payload_release_id
    and dguid = any(coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb)) as value),
      '{}'::text[]
    ));
  end if;

  update public.archive_branches
  set
    head_version_id = version_row.id,
    head_version_number = version_row.version_number,
    resource_version = branch_row.resource_version + 1,
    updated_at = now()
  where id = branch_row.id
  returning * into branch_row;

  update public.workspace_archive_requests
  set state = 'consumed', resource_version = request_row.resource_version + 1, updated_at = now()
  where id = request_row.id;

  update public.submissions
  set
    status = 'archived',
    resource_version = submission_row.resource_version + 1,
    active_claim_pruid = null,
    active_claim_kind = null,
    active_claim_actor_id = null,
    active_claim_at = null,
    updated_at = now()
  where id = submission_row.id;

  return jsonb_build_object(
    'versionId', version_row.id,
    'branchId', branch_row.id,
    'branchKey', branch_row.branch_key,
    'versionNumber', version_row.version_number,
    'archiveMapRevision', map_revision_row.sequence
  );
end;
$$;

create or replace function public.revert_archive_version_v2(
  p_version_id uuid,
  p_merged_by uuid,
  p_expected_branch_version bigint,
  p_expected_map_revision bigint default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_version public.archive_versions%rowtype;
  branch_row public.archive_branches%rowtype;
  version_row public.archive_versions%rowtype;
  map_revision_row public.archive_map_revisions%rowtype;
  next_version_number integer;
  submission_type text;
  cp_payload jsonb := coalesce(p_payload->'counterProposal', 'null'::jsonb);
  affected_dguid text;
  current_map_revision bigint;
begin
  select * into target_version
  from public.archive_versions
  where id = p_version_id;
  if not found then
    raise exception 'archive version not found' using errcode = 'P0001', message = 'ARCHIVE_VERSION_NOT_FOUND';
  end if;

  select * into branch_row
  from public.archive_branches
  where id = target_version.branch_id
  for update;
  if not found then
    raise exception 'archive branch not found' using errcode = 'P0002';
  end if;
  if branch_row.resource_version <> p_expected_branch_version then
    raise exception 'archive branch is stale' using errcode = 'P0001', message = 'STALE_ARCHIVE_BRANCH';
  end if;

  submission_type := branch_row.submission_type;
  if submission_type = 'counter_proposal' then
    select coalesce(max(sequence), 0) into current_map_revision
    from public.archive_map_revisions
    where archive_map_revisions.release_id = branch_row.release_id;
    if p_expected_map_revision is null or current_map_revision <> p_expected_map_revision then
      raise exception 'archived map is stale' using errcode = 'P0001', message = 'STALE_ARCHIVE_MAP';
    end if;
  end if;
  select coalesce(max(version_number), 0) + 1
  into next_version_number
  from public.archive_versions
  where branch_id = branch_row.id;

  insert into public.archive_versions (
    branch_id, version_number, version_kind, source_submission_id,
    revert_target_version_id, submission_projection, branch_vertex_snapshot,
    result_geometry, display_geometry, geometry_digest, validation_report,
    closing_comment, merged_by, merged_at
  ) values (
    branch_row.id,
    next_version_number,
    'revert',
    target_version.source_submission_id,
    target_version.id,
    target_version.submission_projection,
    case when submission_type = 'counter_proposal' then cp_payload->'branchVertexSnapshot' else null end,
    case when submission_type = 'counter_proposal' then cp_payload->'resultGeometry' else null end,
    case when submission_type = 'counter_proposal' then cp_payload->'displayGeometry' else null end,
    nullif(cp_payload->>'geometryDigest', ''),
    coalesce(cp_payload->'validationReport', '{}'::jsonb),
    jsonb_build_object('revertedToVersionId', target_version.id),
    p_merged_by,
    now()
  )
  returning * into version_row;

  if submission_type = 'counter_proposal' and cp_payload is not null and cp_payload <> 'null'::jsonb then
    insert into public.archive_version_operations (
      archive_version_id, operation_index, vertex_id,
      from_lng, from_lat, to_lng, to_lat, source_submission_operation_index
    )
    select
      version_row.id,
      (operation->>'operation_index')::integer,
      operation->>'vertex_id',
      (operation->>'from_lng')::double precision,
      (operation->>'from_lat')::double precision,
      (operation->>'to_lng')::double precision,
      (operation->>'to_lat')::double precision,
      nullif(operation->>'source_submission_operation_index', '')::integer
    from jsonb_array_elements(coalesce(cp_payload->'operations', '[]'::jsonb)) as operation;

    delete from public.archive_vertex_state where branch_id = branch_row.id;
    insert into public.archive_vertex_state (
      branch_id, vertex_id, lng, lat, last_merge_sequence, last_version_id, source_submission_id
    )
    select
      branch_row.id,
      vertex->>'vertexId',
      (vertex->>'lng')::double precision,
      (vertex->>'lat')::double precision,
      version_row.merge_sequence,
      version_row.id,
      target_version.source_submission_id
    from jsonb_array_elements(coalesce(cp_payload->'branchVertexSnapshot'->'vertices', '[]'::jsonb)) as vertex;

    insert into public.archive_map_revisions (
      release_id, source_archive_version_id, source_branch_key, source_submission_ids,
      transition_kind, affected_dguids, before_digests, after_digests, created_by
    ) values (
      branch_row.release_id,
      version_row.id,
      branch_row.branch_key,
      array[target_version.source_submission_id],
      'revert',
      coalesce(
        (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb)) as value),
        '{}'::text[]
      ),
      coalesce(cp_payload->'beforeDigests', '{}'::jsonb),
      coalesce(cp_payload->'afterDigests', '{}'::jsonb),
      p_merged_by
    )
    returning * into map_revision_row;

    for affected_dguid in
      select jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb))
    loop
      update public.archive_map_da_heads
      set
        uses_base = coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false),
        geometry = case
          when coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false) then null
          else cp_payload->'headGeometry'->affected_dguid
        end,
        display_geometry = case
          when coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false) then null
          else cp_payload->'headDisplayGeometry'->affected_dguid
        end,
        geometry_digest = cp_payload->'afterDigests'->>affected_dguid,
        resource_version = resource_version + 1,
        last_map_revision_sequence = map_revision_row.sequence,
        last_archive_version_id = version_row.id,
        updated_at = now()
      where release_id = branch_row.release_id and dguid = affected_dguid;
    end loop;
  end if;

  update public.archive_branches
  set
    head_version_id = version_row.id,
    head_version_number = version_row.version_number,
    resource_version = branch_row.resource_version + 1,
    updated_at = now()
  where id = branch_row.id
  returning * into branch_row;

  return jsonb_build_object(
    'versionId', version_row.id,
    'branchId', branch_row.id,
    'versionNumber', version_row.version_number,
    'archiveMapRevision', map_revision_row.sequence
  );
end;
$$;

create or replace function public.reinitialize_archive_branch_v2(
  p_branch_id uuid,
  p_actor uuid,
  p_expected_branch_version bigint,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  branch_row public.archive_branches%rowtype;
  target_submission_id uuid;
  target_source_revision_id uuid;
  map_revision_row public.archive_map_revisions%rowtype;
  cp_payload jsonb := coalesce(p_payload->'counterProposal', 'null'::jsonb);
  affected_dguid text;
  current_map_revision bigint;
begin
  select * into branch_row
  from public.archive_branches
  where id = p_branch_id
  for update;
  if not found then
    raise exception 'archive branch not found' using errcode = 'P0001', message = 'ARCHIVE_BRANCH_NOT_FOUND';
  end if;
  if branch_row.resource_version <> p_expected_branch_version then
    raise exception 'archive branch is stale' using errcode = 'P0001', message = 'STALE_ARCHIVE_BRANCH';
  end if;

  for target_submission_id in
    select distinct archive_versions.source_submission_id
    from public.archive_versions
    where archive_versions.branch_id = branch_row.id
      and archive_versions.source_submission_id is not null
  loop
    update public.submissions
    set
      status = 'pending',
      resource_version = resource_version + 1,
      active_claim_pruid = null,
      active_claim_kind = null,
      active_claim_actor_id = null,
      active_claim_at = null,
      updated_at = now()
    where id = target_submission_id;

    insert into public.workspace_comments (
      submission_id, author_id, content, action, is_closing, created_at
    ) values (
      target_submission_id,
      p_actor,
      'This submission was reinitialized after its Archived Tree branch was deleted forever.',
      'archive_branch_reinitialized',
      false,
      now()
    );

    for target_source_revision_id in
      select workspace_archive_requests.source_revision_id
      from public.workspace_archive_requests
      where workspace_archive_requests.submission_id = target_submission_id
    loop
      delete from public.workspace_archive_requests
      where workspace_archive_requests.submission_id = target_submission_id;
      delete from public.archive_source_revisions
      where id = target_source_revision_id
        and not exists (
          select 1 from public.workspace_archive_requests
          where workspace_archive_requests.source_revision_id = target_source_revision_id
        );
    end loop;
  end loop;

  if branch_row.submission_type = 'counter_proposal' and cp_payload is not null and cp_payload <> 'null'::jsonb then
    select coalesce(max(sequence), 0) into current_map_revision
    from public.archive_map_revisions
    where archive_map_revisions.release_id = branch_row.release_id;
    if current_map_revision <> coalesce((cp_payload->>'expectedMapRevision')::bigint, current_map_revision) then
      raise exception 'archived map is stale' using errcode = 'P0001', message = 'STALE_ARCHIVE_MAP';
    end if;
    insert into public.archive_map_revisions (
      release_id, source_branch_key, source_submission_ids, transition_kind,
      affected_dguids, before_digests, after_digests, created_by
    ) values (
      branch_row.release_id,
      branch_row.branch_key,
      coalesce(
        (select array_agg(distinct source_submission_id) from public.archive_versions where branch_id = branch_row.id and source_submission_id is not null),
        '{}'::uuid[]
      ),
      'delete',
      coalesce(
        (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb)) as value),
        '{}'::text[]
      ),
      coalesce(cp_payload->'beforeDigests', '{}'::jsonb),
      coalesce(cp_payload->'afterDigests', '{}'::jsonb),
      p_actor
    )
    returning * into map_revision_row;

    for affected_dguid in
      select jsonb_array_elements_text(coalesce(cp_payload->'affectedDguids', '[]'::jsonb))
    loop
      update public.archive_map_da_heads
      set
        uses_base = coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false),
        geometry = case
          when coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false) then null
          else cp_payload->'headGeometry'->affected_dguid
        end,
        display_geometry = case
          when coalesce((cp_payload->'usesBase'->>affected_dguid)::boolean, false) then null
          else cp_payload->'headDisplayGeometry'->affected_dguid
        end,
        geometry_digest = cp_payload->'afterDigests'->>affected_dguid,
        resource_version = resource_version + 1,
        last_map_revision_sequence = map_revision_row.sequence,
        last_archive_version_id = null,
        updated_at = now()
      where release_id = branch_row.release_id and dguid = affected_dguid;
    end loop;
  end if;

  delete from public.archive_branches where id = branch_row.id;

  return jsonb_build_object(
    'branchId', p_branch_id,
    'branchKey', branch_row.branch_key,
    'archiveMapRevision', map_revision_row.sequence
  );
end;
$$;

revoke all on function public.commit_archive_merge_v2(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.revert_archive_version_v2(uuid, uuid, bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.reinitialize_archive_branch_v2(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.commit_archive_merge_v2(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.revert_archive_version_v2(uuid, uuid, bigint, bigint, jsonb) to service_role;
grant execute on function public.reinitialize_archive_branch_v2(uuid, uuid, bigint, jsonb) to service_role;

