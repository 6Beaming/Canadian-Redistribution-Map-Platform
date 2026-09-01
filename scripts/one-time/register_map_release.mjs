#!/usr/bin/env node
import "dotenv/config";
import { loadLocalRelease, requireAdminClient } from "../reusable/map_release_db.mjs";

const apply = process.argv.includes("--apply");
const releaseIdFlag = process.argv.indexOf("--release-id");
const releaseId = releaseIdFlag >= 0 ? process.argv[releaseIdFlag + 1] : undefined;
const release = loadLocalRelease({ releaseId });
const identity = {
  releaseId: release.manifest.releaseId,
  geometryRevision: release.manifest.geometryRevision,
  manifestSha256: release.manifest.manifestSha256,
  topologyRevision: release.manifest.topologyRevision,
  normalizationVersion: release.manifest.normalizationVersion,
  vertexSchemaVersion: release.manifest.vertexSchemaVersion,
  lodSchemaVersion: release.manifest.lodSchemaVersion,
};

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", identity }, null, 2));
if (!apply) {
  console.log("Dry run only. Re-run with --apply after validate_map_release.py succeeds.");
  process.exit(0);
}

const supabase = requireAdminClient();
const { data: activated, error } = await supabase.rpc("activate_map_data_release", {
  p_release_id: identity.releaseId,
  p_geometry_revision: identity.geometryRevision,
  p_manifest_sha256: identity.manifestSha256,
  p_topology_revision: identity.topologyRevision,
  p_normalization_version: identity.normalizationVersion,
  p_vertex_schema_version: identity.vertexSchemaVersion,
  p_lod_schema_version: identity.lodSchemaVersion,
  p_metadata: { sourceManifestGeneratedAt: release.manifest.sourceManifestGeneratedAt },
});
if (error) {
  throw new Error(`Release activation failed: ${error.message}`);
}
const { error: genesisError } = await supabase.rpc("ensure_archive_map_genesis", {
  p_release_id: identity.releaseId,
});
if (genesisError) {
  throw new Error(`Archive map genesis failed: ${genesisError.message}`);
}
console.log(JSON.stringify({ activated: activated?.release_id ?? identity.releaseId, ok: true }));

