import {
  loadCurrentCanonicalRelease,
  readCanonicalDaPair,
  readExactDaFeature,
} from "../map/canonicalReleaseStore.js";
import { listArchiveTreeRecords } from "./archiveRepository.js";
import { getArchivedMapSnapshot } from "./archivedMapRepository.js";

function writeJsonValue(stream, value) {
  stream.write(JSON.stringify(value));
}

async function loadVersionGeometry(supabase, versionId) {
  const { data } = await supabase
    .from("archive_versions")
    .select("result_geometry, display_geometry, validation_report")
    .eq("id", versionId)
    .maybeSingle();
  return data ?? null;
}

export async function streamArchiveTreeExport(res, supabase) {
  const release = loadCurrentCanonicalRelease();
  const { records } = await listArchiveTreeRecords(supabase);
  const snapshot = await getArchivedMapSnapshot(supabase, { dguids: [] });
  const branchesByKey = new Map();

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
  }

  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": "attachment; filename=archived-tree.json",
    "Cache-Control": "no-store",
  });

  const stream = res;
  stream.write("{");
  writeJsonValue(stream, "schemaVersion");
  stream.write(':"1.0",');
  writeJsonValue(stream, "releaseId");
  stream.write(`:${JSON.stringify(release.manifest.releaseId)},`);
  writeJsonValue(stream, "archiveMapRevision");
  stream.write(`:${JSON.stringify(snapshot.archiveMapRevision ?? 0)},`);
  writeJsonValue(stream, "exportedAt");
  stream.write(`:${JSON.stringify(new Date().toISOString())},`);
  writeJsonValue(stream, "mapHeads");
  stream.write(`:${JSON.stringify(snapshot.heads ?? [])},`);
  writeJsonValue(stream, "branches");
  stream.write(":[");

  const branches = [...branchesByKey.values()].sort((left, right) =>
    left.branchKey.localeCompare(right.branchKey),
  );
  let branchIndex = 0;
  for (const branch of branches) {
    if (branchIndex) stream.write(",");
    stream.write("{");
    writeJsonValue(stream, "branchKey");
    stream.write(`:${JSON.stringify(branch.branchKey)},`);
    writeJsonValue(stream, "submissionType");
    stream.write(`:${JSON.stringify(branch.submissionType)},`);
    writeJsonValue(stream, "primaryDguid");
    stream.write(`:${JSON.stringify(branch.primaryDguid)},`);
    writeJsonValue(stream, "secondaryDguid");
    stream.write(`:${JSON.stringify(branch.secondaryDguid)},`);
    writeJsonValue(stream, "versions");
    stream.write(":[");

    const versions = branch.versions.sort((left, right) =>
      Number(left.versionNumber) - Number(right.versionNumber),
    );
    for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
      const version = versions[versionIndex];
      if (versionIndex) stream.write(",");
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
        try {
          const { feature } = await readExactDaFeature(release, branch.primaryDguid);
          exportVersion.baseFeature = feature;
        } catch {
          exportVersion.baseFeature = null;
        }
      } else if (branch.submissionType === "objection") {
        try {
          const pair = await readCanonicalDaPair(
            release,
            branch.primaryDguid,
            branch.secondaryDguid,
            { representation: "display" },
          );
          exportVersion.basePair = pair.features;
          exportVersion.sharedBoundary = pair.sharedBoundary;
        } catch {
          exportVersion.basePair = null;
          exportVersion.sharedBoundary = null;
        }
      } else if (branch.submissionType === "counter_proposal" && version.versionId) {
        const geometry = await loadVersionGeometry(supabase, version.versionId);
        exportVersion.resultGeometry = geometry?.result_geometry ?? null;
        exportVersion.displayGeometry = geometry?.display_geometry ?? null;
        exportVersion.validationReport = geometry?.validation_report ?? null;
      }

      writeJsonValue(stream, exportVersion);
    }

    stream.write("]}");
    branchIndex += 1;
  }

  stream.write("]}");
}
