import temporaryCounterProposalData from "@/data/map/temp.json" with { type: "json" };
import {
  buildCounterProposalCache,
  previewCounterProposalHandleMove,
} from "@/lib/map/counterProposalWorkflow.js";
import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { getAllComments } from "@/services/commentsApi.js";
import { mapApi } from "@/services/mapApi.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const metadataByFedPromise = new Map();
let profilesPromise = null;

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

async function getMetadataForFed(fedNum) {
  const normalizedFedNum = normalizeFedNum(fedNum);

  if (!normalizedFedNum) {
    return EMPTY_FEATURE_COLLECTION;
  }

  if (!metadataByFedPromise.has(normalizedFedNum)) {
    metadataByFedPromise.set(
      normalizedFedNum,
      mapApi.fetchAssetJson(`metadata/fed_${normalizedFedNum}.geojson`),
    );
  }

  return metadataByFedPromise.get(normalizedFedNum);
}

async function getPairIndex(submission, profilesByDguid) {
  const firstDguid = String(submission?.dguid ?? "");
  const secondDguid = String(submission?.neighboring_dguid ?? "");
  const firstFedNum = normalizeFedNum(submission?.fed_num);
  const secondFedNum = normalizeFedNum(profilesByDguid.get(secondDguid)?.fed_num) || firstFedNum;
  const fedNums = [...new Set([firstFedNum, secondFedNum].filter(Boolean))];

  if (!firstDguid || !secondDguid || !fedNums.length) {
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
  const geometry = index
    ? buildOriginalPairGeometry(index, normalized.dguid, normalized.neighboring_dguid)
    : null;

  return {
    ...normalized,
    geometry,
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

async function hydrateTemporaryCounterProposal(submission, profilesByDguid) {
  const normalized = normalizeSubmission(submission, "temporary-counter-proposal");
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

function isRelatedToDguid(submission, dguid) {
  const targetDguid = String(dguid ?? "");
  return (
    String(submission?.dguid ?? "") === targetDguid ||
    String(submission?.neighboring_dguid ?? "") === targetDguid
  );
}

/**
 * Returns the dashboard's three submission collections for one selected DA.
 * Supabase remains authoritative for comments and objections. Counter-proposal
 * records are a deliberately temporary local fixture until their write API is
 * implemented.
 */
/**
 * Transitional Dashboard read: combines live feedback/objections with local
 * Counter-Proposal fixtures until a dedicated Counter-Proposal API exists.
 */
export async function getDashboardSubmissionCollections(dguid, profilesByDguid) {
  if (!dguid) {
    return { comments: [], objections: [], counterProposals: [] };
  }

  const profiles = await getProfilesByDguid(profilesByDguid);
  const submissions = await getAllComments();
  const relatedSubmissions = submissions.filter((submission) => isRelatedToDguid(submission, dguid));
  const comments = relatedSubmissions
    .filter((submission) => normalizeSubmissionType(submission.type) === "feedback")
    .map((submission) => normalizeSubmission(submission, "supabase"));
  const objectionRows = relatedSubmissions.filter(
    (submission) => normalizeSubmissionType(submission.type) === "objection",
  );
  const counterProposalRows = temporaryCounterProposalData.submissions.filter((submission) =>
    isRelatedToDguid(submission, dguid),
  );

  const [objections, counterProposals] = await Promise.all([
    Promise.all(objectionRows.map((submission) => hydrateObjection(submission, profiles))),
    Promise.all(
      counterProposalRows.map((submission) => hydrateTemporaryCounterProposal(submission, profiles)),
    ),
  ]);

  return { comments, objections, counterProposals };
}

/** Local fixture lookup with browser-side geometry hydration for one review page. */
export async function getTemporaryCounterProposalById(id, profilesByDguid) {
  const submission = temporaryCounterProposalData.submissions.find(
    (entry) => entry.id === id,
  );

  if (!submission) {
    return null;
  }

  const profiles = await getProfilesByDguid(profilesByDguid);
  return hydrateTemporaryCounterProposal(submission, profiles);
}

/**
 * Local fixture read used by the Commissioner submissions table. This method
 * deliberately returns the lightweight submission envelope only; table pages
 * must not hydrate or validate geometry.
 */
/** List-safe fixture rows; deliberately excludes hydrated GeoJSON. */
export function getTemporaryCounterProposalSubmissions() {
  return temporaryCounterProposalData.submissions.map((submission) => ({
    ...submission,
    profile: submission.profile ? { ...submission.profile } : null,
    geometry_edit: submission.geometry_edit
      ? structuredClone(submission.geometry_edit)
      : null,
  }));
}

/**
 * Hydrates one live objection or temporary Counter-Proposal for review.
 * Live objections currently reconstruct geometry from canonical map metadata;
 * replace this with immutable submission snapshots when the write API exists.
 */
export async function hydrateWorkspaceSubmission(submission, profilesByDguid) {
  const profiles = await getProfilesByDguid(profilesByDguid);
  const type = normalizeSubmissionType(submission?.type);

  if (type === "counter-proposal") {
    return hydrateTemporaryCounterProposal(submission, profiles);
  }

  if (type === "objection") {
    return hydrateObjection(submission, profiles);
  }

  return hydrateComment(submission, profiles);
}

export function getTemporaryCounterProposalDefinitions() {
  return getTemporaryCounterProposalSubmissions();
}
