import {
  buildCounterProposalCache,
  previewCounterProposalHandleMove,
} from "@/lib/map/counterProposalWorkflow.js";
import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import {
  getFallbackDaAssetManifest,
  getMetadataGeojsonPathsForFed,
  normalizeDaAssetManifest,
} from "@/lib/map/daAssetManifest.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { getAllComments } from "@/services/commentsApi.js";
import { mapApi } from "@/services/mapApi.js";
import {
  getCounterProposal,
  getCounterProposals,
  getSubmissionMaterializedGeometry,
} from "@/services/submissionsApi.js";
import { calculateCounterProposalImpact } from "@/lib/map/counterProposalImpact.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const metadataByFedPromise = new Map();
let profilesPromise = null;
let assetManifestPromise = null;

function normalizeFedNum(value) {
  return String(value ?? "").trim();
}

function normalizeSubmissionType(value) {
  const type = String(value ?? "feedback").trim().toLowerCase();
  if (type === "counter_proposal") return "counter-proposal";
  return type === "comment" ? "feedback" : type;
}

function cloneFeatureCollection(featureCollection) {
  return structuredClone(featureCollection ?? EMPTY_FEATURE_COLLECTION);
}

async function getProfilesByDguid(profilesByDguid) {
  if (profilesByDguid instanceof Map) {
    return profilesByDguid;
  }

  if (!profilesPromise) {
    profilesPromise = mapApi.getDaProfiles().then((payload) => buildProfileIndex(payload).index);
  }

  return profilesPromise;
}

async function getAssetManifest() {
  if (!assetManifestPromise) {
    assetManifestPromise = mapApi.getDaAssetManifest()
      .then((manifest) => normalizeDaAssetManifest(manifest))
      .catch(() => getFallbackDaAssetManifest());
  }
  return assetManifestPromise;
}

async function getMetadataForFed(fedNum) {
  const normalizedFedNum = normalizeFedNum(fedNum);

  if (!normalizedFedNum) {
    return EMPTY_FEATURE_COLLECTION;
  }

  if (!metadataByFedPromise.has(normalizedFedNum)) {
    metadataByFedPromise.set(
      normalizedFedNum,
      (async () => {
        try {
          const manifest = await getAssetManifest();
          const paths = getMetadataGeojsonPathsForFed(manifest, normalizedFedNum);
          // Prefer manifest shard paths (multipart FEDs). Fall back to the
          // conventional single-file name used by most districts.
          const assetPaths = paths.length
            ? paths
            : [`metadata/fed_${normalizedFedNum}.geojson`];
          // Guard against the manifest helper falling back to the wrong FED
          // (first asset) when the requested FED is missing.
          const resolvedPaths = assetPaths.every((path) => path.includes(`fed_${normalizedFedNum}`))
            ? assetPaths
            : [`metadata/fed_${normalizedFedNum}.geojson`];
          const collections = await Promise.all(
            resolvedPaths.map((path) => mapApi.fetchAssetJson(path)),
          );
          return {
            type: "FeatureCollection",
            features: collections.flatMap((collection) => collection?.features ?? []),
          };
        } catch (error) {
          console.warn(`Failed to load FED metadata ${normalizedFedNum}`, error);
          metadataByFedPromise.delete(normalizedFedNum);
          return EMPTY_FEATURE_COLLECTION;
        }
      })(),
    );
  }

  return metadataByFedPromise.get(normalizedFedNum);
}

async function getPairIndex(submission, profilesByDguid) {
  const firstDguid = String(submission?.dguid ?? "").trim();
  const secondDguid = String(submission?.neighboring_dguid ?? "").trim();
  const firstProfile = profilesByDguid?.get?.(firstDguid) ?? null;
  const secondProfile = profilesByDguid?.get?.(secondDguid) ?? null;
  // Prefer live profile FED mapping over serialized enrichment fields, which
  // historically collapsed the neighbour onto the primary FED.
  const firstFedNum = normalizeFedNum(
    firstProfile?.fed_num
    ?? submission?.primary_fed_num
    ?? submission?.fed_num,
  );
  const secondFedNum = normalizeFedNum(
    secondProfile?.fed_num
    ?? submission?.secondary_fed_num,
  );
  const fedNums = [...new Set([firstFedNum, secondFedNum].filter(Boolean))];

  if (!firstDguid || !secondDguid || !firstFedNum || !secondFedNum) {
    return null;
  }

  const featureCollections = await Promise.all(fedNums.map(getMetadataForFed));
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: featureCollections.flatMap((collection) => collection?.features ?? []),
  });

  if (!index.featureByDguid.has(firstDguid) || !index.featureByDguid.has(secondDguid)) {
    return null;
  }

  return index;
}

function buildOriginalPairGeometry(index, firstDguid, secondDguid) {
  const features = [firstDguid, secondDguid]
    .map((dguid) => index?.featureByDguid.get(String(dguid)))
    .filter(Boolean);

  if (features.length !== 2) {
    return null;
  }

  return {
    featureCollection: { type: "FeatureCollection", features },
    boundaryGeoJson: getSharedBoundaryFeatureCollection(index, firstDguid, secondDguid),
    outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [firstDguid, secondDguid]),
  };
}

function normalizeSubmission(submission, source) {
  return {
    ...submission,
    type: normalizeSubmissionType(submission?.type),
    authorEmail: submission?.profile?.email ?? submission?.authorEmail ?? null,
    source,
  };
}

async function hydrateObjection(submission, profilesByDguid) {
  const normalized = normalizeSubmission(submission, "supabase");
  const index = await getPairIndex(normalized, profilesByDguid);
  if (!index) {
    return {
      ...normalized,
      geometry: null,
      geometryError:
        "Objection map geometry could not be rebuilt for this DA pair. "
        + "Both dissemination areas must resolve to local FED metadata.",
    };
  }

  const geometry = buildOriginalPairGeometry(
    index,
    normalized.dguid,
    normalized.neighboring_dguid,
  );

  return {
    ...normalized,
    geometry,
    geometryError: geometry
      ? null
      : "Objection map geometry could not be prepared for this DA pair.",
  };
}

async function hydrateComment(submission, profilesByDguid) {
  const normalized = normalizeSubmission(submission, submission?.source ?? "supabase");
  const dguid = String(normalized.dguid ?? "");
  const fedNum = normalizeFedNum(normalized.fed_num || profilesByDguid.get(dguid)?.fed_num);

  if (!dguid || !fedNum) return { ...normalized, geometry: null };
  const metadata = await getMetadataForFed(fedNum);
  const index = buildDaObjectionIndex(metadata);
  const feature = index.featureByDguid.get(dguid);

  if (!feature) return { ...normalized, geometry: null };
  return {
    ...normalized,
    geometry: {
      featureCollection: { type: "FeatureCollection", features: [feature] },
      boundaryGeoJson: EMPTY_FEATURE_COLLECTION,
      outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [dguid]),
    },
  };
}

function hasPersistedRevisionGeometry(revision) {
  return Boolean(
    revision?.original_geometry?.features?.length
    && revision?.proposed_geometry?.features?.length,
  );
}

export function hydrateFromPersistedRevision(submission, revision, profilesByDguid = new Map()) {
  const firstDguid = String(revision.primary_dguid || submission.dguid || "");
  const secondDguid = String(revision.secondary_dguid || submission.neighboring_dguid || "");
  const originalGeometry = cloneFeatureCollection(revision.original_geometry);
  const proposedGeometry = cloneFeatureCollection(revision.proposed_geometry);
  const originalIndex = buildDaObjectionIndex(originalGeometry);
  const proposedIndex = buildDaObjectionIndex(proposedGeometry);
  const persistedImpact = revision.validation_report?.impact_summary ?? null;
  const impactSummary = persistedImpact ?? calculateCounterProposalImpact({
    originalFeatures: originalGeometry,
    proposedFeatures: proposedGeometry,
    firstDguid,
    secondDguid,
    populationByDguid: {
      [firstDguid]: profilesByDguid.get(firstDguid)?.population ?? submission.primary_population ?? null,
      [secondDguid]: profilesByDguid.get(secondDguid)?.population ?? submission.secondary_population ?? null,
    },
  });

  return {
    ...normalizeSubmission(submission, "supabase"),
    revision,
    geometry: {
      originalFeatureCollection: originalGeometry,
      proposedFeatureCollection: proposedGeometry,
      originalBoundaryGeoJson: getSharedBoundaryFeatureCollection(
        originalIndex,
        firstDguid,
        secondDguid,
      ),
      originalOuterBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(
        originalIndex,
        [firstDguid, secondDguid],
      ),
      boundaryGeoJson: cloneFeatureCollection(
        revision.shared_boundary
        ?? getSharedBoundaryFeatureCollection(proposedIndex, firstDguid, secondDguid),
      ),
      outerBoundaryGeoJson: cloneFeatureCollection(
        revision.outer_boundary
        ?? getPairOuterBoundaryFeatureCollection(proposedIndex, [firstDguid, secondDguid]),
      ),
      impacts: impactSummary,
      impactsSource: persistedImpact ? "persisted" : "legacy-fallback",
      baselineRevision: revision.baseline_revision ?? null,
      validationReport: revision.validation_report ?? null,
    },
  };
}

/** Replay legacy fixture-style geometry_edit operations when no revision exists. */
async function hydrateFromGeometryEdit(submission, profilesByDguid) {
  const normalized = normalizeSubmission(submission, submission.source ?? "supabase");
  const index = await getPairIndex(normalized, profilesByDguid);

  if (!index) {
    return { ...normalized, geometry: null };
  }

  const originalGeometry = buildOriginalPairGeometry(
    index,
    normalized.dguid,
    normalized.neighboring_dguid,
  );
  let cache = buildCounterProposalCache(
    index,
    profilesByDguid,
    normalized.dguid,
    normalized.neighboring_dguid,
  );

  if (!cache || cache.sourceGeometryIssues?.length) {
    return {
      ...normalized,
      geometry: originalGeometry,
      geometryError: cache?.sourceGeometryIssues?.[0]?.reason ?? "The DA pair could not be prepared.",
    };
  }

  for (const operation of normalized.geometry_edit?.operations ?? []) {
    cache = previewCounterProposalHandleMove(
      cache,
      operation.handle_id,
      operation.requested_coordinate,
    );
  }

  return {
    ...normalized,
    geometry: {
      originalFeatureCollection: cloneFeatureCollection(originalGeometry?.featureCollection),
      proposedFeatureCollection: cloneFeatureCollection(cache.currentFeatureCollection),
      originalBoundaryGeoJson: cloneFeatureCollection(originalGeometry?.boundaryGeoJson),
      originalOuterBoundaryGeoJson: cloneFeatureCollection(originalGeometry?.outerBoundaryGeoJson),
      boundaryGeoJson: cloneFeatureCollection(cache.sharedBoundaryGeoJson),
      outerBoundaryGeoJson: cloneFeatureCollection(
        getPairOuterBoundaryFeatureCollection(index, [normalized.dguid, normalized.neighboring_dguid]),
      ),
      impacts: cache.impacts,
      sourceGeometryRepairs: cache.sourceGeometryRepairs,
    },
  };
}

/** V2 counter-proposals store compact operations in submission_geometry_revisions. */
async function hydrateFromCompactGeometryRevision(submission) {
  const normalized = normalizeSubmission(submission, "supabase");
  if (!normalized.id) return null;

  let detail;
  try {
    detail = await getSubmissionMaterializedGeometry(normalized.id);
  } catch (error) {
    if (![404, 409].includes(error.status)) {
      console.warn("Unable to load compact counter-proposal geometry.", error);
    }
    return null;
  }

  const releaseId = detail.releaseId ?? normalized.release_id;
  const primaryDguid = detail.primaryDguid ?? normalized.dguid;
  const secondaryDguid = detail.secondaryDguid ?? normalized.neighboring_dguid;

  if (!releaseId || !primaryDguid || !secondaryDguid || !detail.geometry) {
    return null;
  }

  try {
    const basePair = await mapApi.getReleaseDaPair(releaseId, primaryDguid, secondaryDguid, {
      representation: "display",
    });
    const baseIndex = buildDaObjectionIndex(basePair.features);
    const proposed = detail.geometry;
    const proposedIndex = buildDaObjectionIndex(proposed);

    return {
      ...normalized,
      geometry: {
        originalFeatureCollection: basePair.features,
        proposedFeatureCollection: proposed,
        originalBoundaryGeoJson: getSharedBoundaryFeatureCollection(
          baseIndex,
          primaryDguid,
          secondaryDguid,
        ),
        originalOuterBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(
          baseIndex,
          [primaryDguid, secondaryDguid],
        ),
        boundaryGeoJson: getSharedBoundaryFeatureCollection(
          proposedIndex,
          primaryDguid,
          secondaryDguid,
        ),
        outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(
          proposedIndex,
          [primaryDguid, secondaryDguid],
        ),
        impacts: detail.impactSummary ?? null,
        impactsSource: "compact-revision",
        baselineRevision: detail.baseRevision ?? null,
      },
    };
  } catch (error) {
    console.warn("Unable to rebuild compact counter-proposal geometry.", error);
    return null;
  }
}

async function hydratePersistedCounterProposal(submission, profilesByDguid) {
  let record = submission;

  if (!hasPersistedRevisionGeometry(record.revision)) {
    try {
      const detailed = await getCounterProposal(record.id);
      if (detailed) {
        record = {
          ...record,
          ...detailed,
          revision: detailed.revision ?? record.revision ?? null,
        };
      }
    } catch (error) {
      console.warn("Unable to load counter-proposal revision detail.", error);
    }
  }

  if (hasPersistedRevisionGeometry(record.revision)) {
    return hydrateFromPersistedRevision(record, record.revision, profilesByDguid);
  }

  if (record.geometry_edit?.operations?.length) {
    return hydrateFromGeometryEdit(record, profilesByDguid);
  }

  const compactHydrated = await hydrateFromCompactGeometryRevision(record);
  if (compactHydrated?.geometry) {
    return compactHydrated;
  }

  return {
    ...normalizeSubmission(record, "supabase"),
    geometry: null,
    geometryError: "No persisted counter-proposal geometry is available for this submission.",
  };
}

/** Load one counter-proposal with persisted revision geometry for review. */
export async function getTemporaryCounterProposalById(id, profilesByDguid) {
  try {
    const submission = await getCounterProposal(id);
    if (!submission) return null;
    const profiles = await getProfilesByDguid(profilesByDguid);
    return hydratePersistedCounterProposal(submission, profiles);
  } catch {
    return null;
  }
}

/**
 * List-safe counter-proposal rows for Workspace / submissions table.
 * Includes revision metadata but does not hydrate map GeoJSON.
 */
export async function getTemporaryCounterProposalSubmissions() {
  try {
    const submissions = await getCounterProposals();
    return (Array.isArray(submissions) ? submissions : []).map((submission) => ({
      ...submission,
      type: normalizeSubmissionType(submission.type),
      profile: submission.profile ? { ...submission.profile } : null,
      authorEmail: submission.authorEmail ?? submission.profile?.email ?? null,
      source: "supabase",
    }));
  } catch (error) {
    console.warn("Persisted counter-proposals are unavailable.", error);
    return [];
  }
}

/**
 * Hydrates one live objection or persisted Counter-Proposal for review.
 * Counter-proposals prefer immutable revision snapshots from Supabase.
 */
export async function hydrateWorkspaceSubmission(submission, profilesByDguid) {
  // Always prefer the full DA profile index so cross-FED / cross-province
  // neighbours resolve to the correct metadata shard.
  const profiles = profilesByDguid instanceof Map && profilesByDguid.size > 0
    ? profilesByDguid
    : await getProfilesByDguid();
  const type = normalizeSubmissionType(submission?.type);

  if (type === "counter-proposal") {
    return hydratePersistedCounterProposal(submission, profiles);
  }

  if (type === "objection") {
    return hydrateObjection(submission, profiles);
  }

  return hydrateComment(submission, profiles);
}

export async function getTemporaryCounterProposalDefinitions() {
  return getTemporaryCounterProposalSubmissions();
}
