import { loadCurrentCanonicalRelease } from "../map/canonicalReleaseStore.js";
import { archiveError } from "./archiveErrors.js";

function parseDguidList(values) {
  const items = Array.isArray(values) ? values : String(values ?? "").split(",");
  return [...new Set(items.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

export async function getArchivedMapSnapshot(supabase, {
  dguids: requestedDguids,
  expectedRevision,
} = {}) {
  const release = loadCurrentCanonicalRelease();
  const releaseId = release.manifest.releaseId;
  const dguids = parseDguidList(requestedDguids);

  const { data: latestRevision, error: revisionError } = await supabase
    .from("archive_map_revisions")
    .select("sequence, release_id")
    .eq("release_id", releaseId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (revisionError) {
    throw archiveError(revisionError.message || "Unable to load archive map revision.", {
      code: "ARCHIVE_MAP_REVISION_FAILED",
    });
  }

  const archiveMapRevision = Number(latestRevision?.sequence ?? 0);
  if (
    expectedRevision !== undefined
    && expectedRevision !== null
    && String(expectedRevision).trim() !== ""
    && Number(expectedRevision) !== archiveMapRevision
  ) {
    throw archiveError("Archived map revision is stale.", {
      statusCode: 409,
      code: "STALE_ARCHIVE_MAP",
    });
  }

  let heads = [];
  if (dguids.length) {
    const { data, error } = await supabase
      .from("archive_map_da_heads")
      .select("dguid, uses_base, display_geometry, geometry_digest, resource_version, last_map_revision_sequence")
      .eq("release_id", releaseId)
      .in("dguid", dguids);
    if (error) {
      throw archiveError(error.message || "Unable to load archived map heads.", {
        code: "ARCHIVE_MAP_HEADS_FAILED",
      });
    }
    heads = data ?? [];
  }

  const overrideFeatures = heads
    .filter((head) => !head.uses_base && head.display_geometry)
    .flatMap((head) => {
      const geometry = head.display_geometry;
      if (geometry?.type === "FeatureCollection") return geometry.features ?? [];
      if (geometry?.type === "Feature") return [geometry];
      return [];
    });

  return {
    releaseId,
    archiveMapRevision,
    heads: heads.map((head) => ({
      dguid: head.dguid,
      usesBase: Boolean(head.uses_base),
      geometryDigest: head.geometry_digest,
      resourceVersion: Number(head.resource_version) || 1,
      lastMapRevisionSequence: Number(head.last_map_revision_sequence) || archiveMapRevision,
      hasDisplayGeometry: Boolean(head.display_geometry),
    })),
    featureCollection: overrideFeatures.length
      ? { type: "FeatureCollection", features: overrideFeatures }
      : { type: "FeatureCollection", features: [] },
    overrideDguids: [...new Set(overrideFeatures.map((feature) => String(
      feature?.properties?.DGUID ?? feature?.properties?.dguid ?? feature?.id ?? "",
    )).filter(Boolean))],
    dguids,
    source: heads.some((head) => !head.uses_base) ? "v2" : "base",
  };
}
