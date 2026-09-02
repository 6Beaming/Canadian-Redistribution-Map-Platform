#!/usr/bin/env node
import "dotenv/config";
import crypto from "node:crypto";
import {
  loadLocalRelease,
  requireAdminClient,
  stableJson,
} from "../reusable/map_release_db.mjs";

const apply = process.argv.includes("--apply");
const release = loadLocalRelease();
const supabase = requireAdminClient();
const releaseId = release.manifest.releaseId;

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function featureDguid(feature) {
  return String(feature?.properties?.DGUID ?? feature?.properties?.dguid ?? feature?.id ?? "").trim();
}

function featuresFromGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === "FeatureCollection") return geometry.features ?? [];
  if (geometry.type === "Feature") return [geometry];
  return [];
}

const { data: branches, error: branchError } = await supabase
  .from("archive_branches")
  .select("id, branch_key, submission_type, primary_dguid, secondary_dguid, head_version_id, head_version_number")
  .eq("submission_type", "counter_proposal")
  .not("head_version_id", "is", null);
if (branchError) throw branchError;

const headVersionIds = (branches ?? []).map((branch) => branch.head_version_id).filter(Boolean);
const { data: versions, error: versionError } = headVersionIds.length
  ? await supabase
    .from("archive_versions")
    .select("id, branch_id, display_geometry, result_geometry, geometry_digest")
    .in("id", headVersionIds)
  : { data: [], error: null };
if (versionError) throw versionError;

const versionsById = new Map((versions ?? []).map((version) => [version.id, version]));
const plannedHeads = [];

for (const branch of branches ?? []) {
  const version = versionsById.get(branch.head_version_id);
  if (!version?.display_geometry || !version?.result_geometry) {
    console.warn(`[skip] ${branch.branch_key} is missing persisted head geometry.`);
    continue;
  }

  const pairDguids = [branch.primary_dguid, branch.secondary_dguid].filter(Boolean);
  const displayFeatures = new Map(
    featuresFromGeometry(version.display_geometry).map((feature) => [featureDguid(feature), feature]),
  );
  const resultFeatures = new Map(
    featuresFromGeometry(version.result_geometry).map((feature) => [featureDguid(feature), feature]),
  );

  for (const dguid of pairDguids) {
    const displayFeature = displayFeatures.get(dguid) ?? null;
    const resultFeature = resultFeatures.get(dguid) ?? null;
    const usesBase = !displayFeature && !resultFeature;
    plannedHeads.push({
      release_id: releaseId,
      dguid,
      uses_base: usesBase,
      geometry: usesBase ? null : (resultFeature ?? displayFeature),
      display_geometry: usesBase ? null : (displayFeature ?? resultFeature),
      geometry_digest: usesBase
        ? digest({ dguid, usesBase: true, releaseId })
        : (version.geometry_digest?.startsWith("sha256:")
          ? version.geometry_digest
          : digest(displayFeature ?? resultFeature)),
      resource_version: 1,
      last_archive_version_id: version.id,
      branch_key: branch.branch_key,
    });
  }
}

console.log(`Planned archive_map_da_heads rows: ${plannedHeads.length}`);
for (const head of plannedHeads) {
  console.log(`- ${head.dguid} (${head.uses_base ? "base" : "override"}) <- ${head.branch_key}`);
}

if (!apply) {
  console.log("Dry run only. Re-run with --apply to write archive_map_da_heads.");
  process.exit(0);
}

const { data: genesis, error: genesisError } = await supabase.rpc("ensure_archive_map_genesis", {
  p_release_id: releaseId,
});
if (genesisError) throw genesisError;

const mapRevisionSequence = Number(genesis?.sequence ?? 0);
let written = 0;

for (const head of plannedHeads) {
  const { error } = await supabase.from("archive_map_da_heads").upsert({
    release_id: head.release_id,
    dguid: head.dguid,
    uses_base: head.uses_base,
    geometry: head.geometry,
    display_geometry: head.display_geometry,
    geometry_digest: head.geometry_digest,
    resource_version: head.resource_version,
    last_map_revision_sequence: mapRevisionSequence,
    last_archive_version_id: head.last_archive_version_id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "release_id,dguid" });
  if (error) throw error;
  written += 1;
}

console.log(`Wrote ${written} archive_map_da_heads row(s) at map revision ${mapRevisionSequence}.`);
