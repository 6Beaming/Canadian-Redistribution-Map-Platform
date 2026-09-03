import fs from "fs";
import path from "path";
import { getMapDataRoot } from "../../map-api-service/paths.js";
import { buildProfileIndex } from "../../../src/lib/map/profileUtils.js";
import {
  buildDaObjectionIndex,
  areDaNeighbours,
} from "../../../src/lib/map/objectionWorkflow.js";
import {
  loadCurrentCanonicalRelease,
  readExactDaFeature,
} from "./canonicalReleaseStore.js";
import { getMaterializationContext } from "./materializationContext.js";

let profileIndexPromise = null;
let assetManifestPromise = null;
const metadataByFedPromise = new Map();

function readJsonFile(relativePath) {
  const filePath = path.join(getMapDataRoot(), relativePath);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function loadProfileIndex() {
  if (!profileIndexPromise) {
    profileIndexPromise = Promise.resolve().then(() => {
      const payload = readJsonFile(path.join("indexes", "da_profile_index.json"));

      if (!payload?.profiles) {
        throw new Error("Map profile index is unavailable.");
      }

      return buildProfileIndex(payload);
    });
  }

  return profileIndexPromise;
}

export async function getProfileForDguid(dguid) {
  const { index } = await loadProfileIndex();
  return index.get(String(dguid ?? "").trim()) ?? null;
}

async function loadAssetManifest() {
  if (!assetManifestPromise) {
    assetManifestPromise = Promise.resolve(
      readJsonFile(path.join("manifests", "da_asset_manifest.json")) ?? {},
    );
  }

  return assetManifestPromise;
}

export function normalizeFedNum(value) {
  return String(value ?? "").trim();
}

export async function loadMetadataGeoJsonForFed(fedNum) {
  const normalizedFedNum = normalizeFedNum(fedNum);

  if (!normalizedFedNum) {
    return { type: "FeatureCollection", features: [] };
  }

  if (!metadataByFedPromise.has(normalizedFedNum)) {
    metadataByFedPromise.set(
      normalizedFedNum,
      Promise.resolve(
        readJsonFile(path.join("metadata", `fed_${normalizedFedNum}.geojson`)) ?? {
          type: "FeatureCollection",
          features: [],
        },
      ),
    );
  }

  return metadataByFedPromise.get(normalizedFedNum);
}

export async function buildBaselineRevision(fedNums = []) {
  const manifest = await loadAssetManifest();
  const generatedAt =
    manifest?.generatedAt ??
    manifest?.version ??
    "unknown";
  const assetPaths = [...new Set(fedNums.map(normalizeFedNum).filter(Boolean))]
    .sort()
    .map((fedNum) => `metadata/fed_${fedNum}.geojson`);

  return `da_asset_manifest:${generatedAt}:${assetPaths.join("|")}`;
}

export async function loadPairObjectionIndex(primaryDguid, secondaryDguid) {
  const firstDguid = String(primaryDguid ?? "").trim();
  const secondDguid = String(secondaryDguid ?? "").trim();

  if (!firstDguid || !secondDguid) {
    throw new MapAssetValidationError("Both DGUIDs are required.");
  }

  if (firstDguid === secondDguid) {
    throw new MapAssetValidationError("A counter-proposal must target two distinct DAs.");
  }

  const release = loadCurrentCanonicalRelease();
  const context = getMaterializationContext();
  const readExact = context
    ? (dguid) => context.getExactDaFeature(release, dguid)
    : (dguid) => readExactDaFeature(release, dguid);
  const [firstRecord, secondRecord] = await Promise.all([
    readExact(firstDguid),
    readExact(secondDguid),
  ]);
  const firstProfile = firstRecord.descriptor.profile ?? null;
  const secondProfile = secondRecord.descriptor.profile ?? null;

  if (!firstRecord.descriptor.enabled || !secondRecord.descriptor.enabled) {
    throw new MapAssetValidationError("Counter-Proposals require two Enabled dissemination areas.");
  }

  if (!firstProfile) {
    throw new MapAssetValidationError(`Unknown or unavailable DA: ${firstDguid}.`);
  }

  if (!secondProfile) {
    throw new MapAssetValidationError(`Unknown or unavailable DA: ${secondDguid}.`);
  }

  const firstFedNum = normalizeFedNum(firstProfile.fed_num);
  const secondFedNum = normalizeFedNum(secondProfile.fed_num) || firstFedNum;
  const fedNums = [...new Set([firstFedNum, secondFedNum].filter(Boolean))];

  if (!fedNums.length) {
    throw new MapAssetValidationError("Unable to resolve the FED context for the selected DA pair.");
  }

  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [firstRecord.feature, secondRecord.feature],
  });

  if (!index.featureByDguid.has(firstDguid)) {
    throw new MapAssetValidationError(`Selected DA is missing from canonical metadata: ${firstDguid}.`);
  }

  if (!index.featureByDguid.has(secondDguid)) {
    throw new MapAssetValidationError(`Selected DA is missing from canonical metadata: ${secondDguid}.`);
  }

  if (!areDaNeighbours(index, firstDguid, secondDguid)) {
    throw new MapAssetValidationError("The selected DAs are not adjacent.");
  }

  const baselineRevision = release.manifest.geometryRevision;

  return {
    index,
    firstDguid,
    secondDguid,
    firstFedNum,
    secondFedNum,
    fedNums,
    profilesByDguid: new Map([
      [firstDguid, firstProfile],
      [secondDguid, secondProfile],
    ]),
    releaseId: release.manifest.releaseId,
    topologyRevision: release.manifest.topologyRevision,
    baselineRevision,
  };
}

export class MapAssetValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MapAssetValidationError";
    this.statusCode = 400;
    this.publicMessage = message;
  }
}
