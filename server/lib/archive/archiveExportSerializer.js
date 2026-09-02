import { once } from "node:events";
import {
  loadCurrentCanonicalRelease,
  readCanonicalDaPair,
  readExactDaFeature,
} from "../map/canonicalReleaseStore.js";
import { listArchiveTreeRecords } from "./archiveRepository.js";
import { getArchivedMapSnapshot } from "./archivedMapRepository.js";

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

function writeJsonValue(stream, value) {
  return writeChunk(stream, JSON.stringify(value));
}

async function batchLoadCounterProposalGeometries(supabase, versionIds) {
  const uniqueIds = [...new Set((versionIds ?? []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("archive_versions")
    .select("id, result_geometry, display_geometry, validation_report")
    .in("id", uniqueIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [String(row.id), row]));
}

function createExportBaseCache(release) {
  const daFeatures = new Map();
  const pairLayers = new Map();

  return {
    async getDaFeature(dguid) {
      const normalized = String(dguid ?? "").trim();
      if (!normalized) return null;
      if (!daFeatures.has(normalized)) {
        const { feature } = await readExactDaFeature(release, normalized);
        daFeatures.set(normalized, feature ?? null);
      }
      return daFeatures.get(normalized);
    },
    async getPairLayers(primaryDguid, secondaryDguid) {
      const pair = [String(primaryDguid ?? "").trim(), String(secondaryDguid ?? "").trim()].sort();
      const key = pair.join("|");
      if (!pairLayers.has(key)) {
        const layers = await readCanonicalDaPair(
          release,
          pair[0],
          pair[1],
          { representation: "display" },
        );
        pairLayers.set(key, layers);
      }
      return pairLayers.get(key);
    },
  };
}

export async function streamArchiveTreeExport(res, supabase) {
  const release = loadCurrentCanonicalRelease();
  const { records } = await listArchiveTreeRecords(supabase);
  const snapshot = await getArchivedMapSnapshot(supabase, {
    dguids: [],
    includeAllHeads: true,
    headsMetadataOnly: true,
  });
  const branchesByKey = new Map();
  const counterProposalVersionIds = [];

  for (const record of records) {
    const branchKey = record.branchKey;
    if (!branchesByKey.has(branchKey)) {
      branchesByKey.set(branchKey, {
        branchKey,
        branchId: record.branchId,
        releaseId: record.releaseId,
        submissionType: record.submissionType,
        primaryDguid: record.primaryDguid,
        secondaryDguid: record.secondaryDguid,
        versions: [],
      });
    }
    branchesByKey.get(branchKey).versions.push(record);
    if (record.submissionType === "counter_proposal" && record.versionId) {
      counterProposalVersionIds.push(record.versionId);
    }
  }

  const geometriesByVersionId = await batchLoadCounterProposalGeometries(
    supabase,
    counterProposalVersionIds,
  );
  const baseCache = createExportBaseCache(release);

  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": "attachment; filename=archived-tree.json",
    "Cache-Control": "no-store",
  });

  const stream = res;
  await writeChunk(stream, "{");
  await writeJsonValue(stream, "schemaVersion");
  await writeChunk(stream, ':"1.0",');
  await writeJsonValue(stream, "releaseId");
  await writeChunk(stream, `:${JSON.stringify(release.manifest.releaseId)},`);
  await writeJsonValue(stream, "archiveMapRevision");
  await writeChunk(stream, `:${JSON.stringify(snapshot.archiveMapRevision ?? 0)},`);
  await writeJsonValue(stream, "exportedAt");
  await writeChunk(stream, `:${JSON.stringify(new Date().toISOString())},`);
  await writeJsonValue(stream, "mapHeads");
  await writeChunk(stream, `:${JSON.stringify(snapshot.heads ?? [])},`);
  await writeJsonValue(stream, "branches");
  await writeChunk(stream, ":[");

  const branches = [...branchesByKey.values()].sort((left, right) =>
    left.branchKey.localeCompare(right.branchKey),
  );
  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const branch = branches[branchIndex];
    if (branchIndex) await writeChunk(stream, ",");
    await writeChunk(stream, "{");
    await writeJsonValue(stream, "branchKey");
    await writeChunk(stream, `:${JSON.stringify(branch.branchKey)},`);
    await writeJsonValue(stream, "submissionType");
    await writeChunk(stream, `:${JSON.stringify(branch.submissionType)},`);
    await writeJsonValue(stream, "primaryDguid");
    await writeChunk(stream, `:${JSON.stringify(branch.primaryDguid)},`);
    await writeJsonValue(stream, "secondaryDguid");
    await writeChunk(stream, `:${JSON.stringify(branch.secondaryDguid)},`);
    await writeJsonValue(stream, "versions");
    await writeChunk(stream, ":[");

    const versions = branch.versions.sort((left, right) =>
      Number(left.versionNumber) - Number(right.versionNumber),
    );
    for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
      const version = versions[versionIndex];
      if (versionIndex) await writeChunk(stream, ",");
      const exportVersion = {
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        versionKind: version.versionKind,
        isLatest: version.isLatest,
        mergedAt: version.mergedAt,
        mergedBy: version.mergedBy,
        closingComment: version.closingComment,
        submission: version.submission,
        geometryDigest: version.geometryDigest ?? null,
      };

      if (branch.submissionType === "comment") {
        exportVersion.baseFeature = await baseCache.getDaFeature(branch.primaryDguid);
      } else if (branch.submissionType === "objection") {
        const pair = await baseCache.getPairLayers(branch.primaryDguid, branch.secondaryDguid);
        exportVersion.basePair = pair.features;
        exportVersion.sharedBoundary = pair.sharedBoundary;
      } else if (branch.submissionType === "counter_proposal" && version.versionId) {
        const geometry = geometriesByVersionId.get(String(version.versionId));
        if (!geometry?.result_geometry) {
          throw new Error(`Archived Counter-Proposal version ${version.versionId} has no exact geometry snapshot.`);
        }
        exportVersion.resultGeometry = geometry.result_geometry ?? null;
        exportVersion.displayGeometry = geometry.display_geometry ?? null;
        exportVersion.validationReport = geometry.validation_report ?? null;
      }

      await writeJsonValue(stream, exportVersion);
    }

    await writeChunk(stream, "]}");
  }

  await writeChunk(stream, "]}");
}
