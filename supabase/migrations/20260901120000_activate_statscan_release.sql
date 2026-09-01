-- Activate the bundled statscan-da-2021-r1 release and backfill submission release metadata.

select public.activate_map_data_release(
  'statscan-da-2021-r1',
  'sha256:24bc2f71ac17271fbca2c648eb4e2c53d2de6509f5fbcb35769aeb7ec1368904',
  'sha256:f89bd52d02ce9226e8f486943431f82590a3ed81279711108b7c63118d342052',
  'sha256:edf7d614b4a45db1f92bfe189018f6fafefdbc50838c200952fdb6baa70cc2e7',
  'wgs84-8dp-v1',
  'shared-array-v1',
  'shared-arc-index-dp-v1',
  '{}'::jsonb
);

update public.submissions
set release_id = 'statscan-da-2021-r1'
where release_id is null
  and dguid is not null;
