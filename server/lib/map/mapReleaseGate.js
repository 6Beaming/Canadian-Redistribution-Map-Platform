import { getSupabaseAdminDataClient } from "../supabase.js";
import { loadCurrentCanonicalRelease, MapReleaseError } from "./canonicalReleaseStore.js";
import {
  buildZeroOperationGeometryDescriptor,
  persistSubmissionGeometryRevision,
} from "./geometryOperations.js";

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

function releaseIdentityFromManifest(manifest) {
  return {
    p_release_id: manifest.releaseId,
    p_geometry_revision: manifest.geometryRevision,
    p_manifest_sha256: manifest.manifestSha256,
    p_topology_revision: manifest.topologyRevision,
    p_normalization_version: manifest.normalizationVersion,
    p_vertex_schema_version: manifest.vertexSchemaVersion,
    p_lod_schema_version: manifest.lodSchemaVersion,
    p_metadata: { sourceManifestGeneratedAt: manifest.sourceManifestGeneratedAt ?? null },
  };
}

export async function ensureActiveMapReleaseRegistered() {
  const status = await getMapReleaseGateStatus({ force: true });
  if (status.ok) {
    return status;
  }

  const supabase = getSupabaseAdminDataClient();
  const { error } = await supabase.rpc(
    "activate_map_data_release",
    releaseIdentityFromManifest(status.release),
  );
  if (error) {
    throw new MapReleaseError(`Unable to activate the local map release: ${error.message}`, {
      code: "MAP_RELEASE_ACTIVATION_FAILED",
      statusCode: 503,
    });
  }

  clearMapReleaseGateCacheForTests();
  const activated = await getMapReleaseGateStatus({ force: true });
  if (!activated.ok) {
    throw new MapReleaseError("The server map release does not match the active database release.", {
      code: "MAP_RELEASE_MISMATCH",
      statusCode: 503,
    });
  }
  return activated;
}

export async function ensureSubmissionReleaseBackfill() {
  const release = loadCurrentCanonicalRelease().manifest;
  const supabase = getSupabaseAdminDataClient();

  const { error: releaseBackfillError } = await supabase
    .from("submissions")
    .update({ release_id: release.releaseId })
    .is("release_id", null);
  if (releaseBackfillError) {
    throw new Error(`Unable to backfill submission release_id: ${releaseBackfillError.message}`);
  }

  const { data: pendingObjections, error: pendingError } = await supabase
    .from("submissions")
    .select("id,user_id,dguid,neighboring_dguid,created_at,type")
    .in("type", ["objection", "counter_proposal"])
    .eq("release_id", release.releaseId);
  if (pendingError) {
    throw new Error(`Unable to inspect submission geometry revisions: ${pendingError.message}`);
  }

  for (const submission of pendingObjections ?? []) {
    const { data: existingRevision, error: revisionLookupError } = await supabase
      .from("submission_geometry_revisions")
      .select("id,migration_state")
      .eq("submission_id", submission.id)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionLookupError) {
      throw new Error(`Unable to inspect geometry revision for ${submission.id}: ${revisionLookupError.message}`);
    }
    if (existingRevision?.migration_state === "ready") {
      continue;
    }
    if (existingRevision) {
      continue;
    }

    if (submission.type !== "objection") {
      continue;
    }

    try {
      const compact = buildZeroOperationGeometryDescriptor({
        primaryDguid: submission.dguid,
        secondaryDguid: submission.neighboring_dguid,
      });
      await persistSubmissionGeometryRevision(supabase, {
        submission,
        submissionType: "objection",
        compact,
        validationReport: { operationCount: 0, migratedFromLegacy: true },
      });
    } catch (error) {
      console.warn(
        `Skipping objection geometry backfill for ${submission.id}: ${error.message}`,
      );
    }
  }
}

