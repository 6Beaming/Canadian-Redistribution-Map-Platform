import { getSupabaseAdminDataClient } from "../supabase.js";
import { loadCurrentCanonicalRelease, MapReleaseError } from "./canonicalReleaseStore.js";

const REQUIRED_FIELDS = [
  ["release_id", "releaseId"],
  ["geometry_revision", "geometryRevision"],
  ["manifest_sha256", "manifestSha256"],
  ["topology_revision", "topologyRevision"],
  ["normalization_version", "normalizationVersion"],
  ["vertex_schema_version", "vertexSchemaVersion"],
  ["lod_schema_version", "lodSchemaVersion"],
];

let cachedGate = null;
const CACHE_MS = 30_000;

export async function getMapReleaseGateStatus({ force = false } = {}) {
  if (!force && cachedGate && Date.now() - cachedGate.checkedAt < CACHE_MS) {
    return cachedGate;
  }
  const local = loadCurrentCanonicalRelease().manifest;
  const supabase = getSupabaseAdminDataClient();
  const { data: active, error } = await supabase
    .from("map_data_releases")
    .select("release_id,geometry_revision,manifest_sha256,topology_revision,normalization_version,vertex_schema_version,lod_schema_version,state")
    .eq("state", "active")
    .maybeSingle();
  if (error) {
    throw new MapReleaseError("Unable to verify the active map release.", {
      code: "MAP_RELEASE_GATE_UNAVAILABLE",
      statusCode: 503,
    });
  }
  const mismatches = [];
  if (!active) {
    mismatches.push({ field: "state", local: "installed", database: "missing" });
  } else {
    for (const [databaseField, manifestField] of REQUIRED_FIELDS) {
      if (active[databaseField] !== local[manifestField]) {
        mismatches.push({ field: databaseField, local: local[manifestField], database: active[databaseField] });
      }
    }
    if (active.state !== "active") {
      mismatches.push({ field: "state", local: "active", database: active.state });
    }
  }
  cachedGate = {
    ok: mismatches.length === 0,
    checkedAt: Date.now(),
    release: local,
    databaseRelease: active ?? null,
    mismatches,
  };
  return cachedGate;
}

export async function assertActiveMapRelease(options) {
  const status = await getMapReleaseGateStatus(options);
  if (!status.ok) {
    throw new MapReleaseError("The server map release does not match the active database release.", {
      code: "MAP_RELEASE_MISMATCH",
      statusCode: 503,
    });
  }
  return status.release;
}

export function clearMapReleaseGateCacheForTests() {
  cachedGate = null;
}

