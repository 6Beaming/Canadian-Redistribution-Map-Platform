import { Flag, GitCompareArrows, MessageSquareText } from "lucide-react";

export const ARCHIVE_CATEGORY_DEFINITIONS = Object.freeze([
  {
    id: "comments",
    title: "Comments towards a DA",
    description: "Expand to browse archived comment branches.",
    icon: MessageSquareText,
    color: "#0f9f94",
  },
  {
    id: "objections",
    title: "Objections towards a Boundary",
    description: "Expand to browse archived objection branches.",
    icon: Flag,
    color: "#087f70",
  },
  {
    id: "counter-proposals",
    title: "Counter-Proposal towards a Boundary",
    description: "Expand to browse archived counter-proposal branches.",
    icon: GitCompareArrows,
    color: "#0b8f78",
  },
]);

export function normalizeArchiveType(value) {
  const type = String(value ?? "feedback").trim().toLowerCase().replaceAll("_", "-");
  if (["feedback", "comment", "comments"].includes(type)) return "feedback";
  if (type === "objection") return "objection";
  if (["counter-proposal", "counterproposal"].includes(type)) return "counter-proposal";
  return "feedback";
}

export function getArchiveCategoryId(value) {
  const type = normalizeArchiveType(value);
  if (type === "objection") return "objections";
  if (type === "counter-proposal") return "counter-proposals";
  return "comments";
}

export function getArchiveBranchKey(submission) {
  const type = normalizeArchiveType(submission?.type);
  const dguids = [submission?.dguid, submission?.neighboring_dguid]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (type !== "feedback") dguids.sort();
  return `${type}:${dguids.join("|") || String(submission?.id ?? "unknown")}`;
}

export function getArchiveCommunityName(submission, profilesByDguid = new Map()) {
  const dguid = String(submission?.dguid ?? "");
  return submission?.community_name
    ?? submission?.communityName
    ?? submission?.dissemination_areas?.community_name
    ?? profilesByDguid.get?.(dguid)?.community_name
    ?? profilesByDguid.get?.(dguid)?.community
    ?? "Unknown community";
}

function compareDates(left, right) {
  return new Date(left?.mergedAt ?? 0) - new Date(right?.mergedAt ?? 0);
}

export function buildArchiveTree(records, profilesByDguid = new Map(), latestOverrides = {}) {
  const categoriesById = new Map(
    ARCHIVE_CATEGORY_DEFINITIONS.map((definition) => [definition.id, {
      ...definition,
      branches: new Map(),
    }]),
  );

  (records ?? []).forEach((record) => {
    const submission = record?.submission;
    if (!submission?.id) return;
    const categoryId = getArchiveCategoryId(submission.type);
    const category = categoriesById.get(categoryId);
    const branchKey = getArchiveBranchKey(submission);
    const dguids = [submission.dguid, submission.neighboring_dguid]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    const existing = category.branches.get(branchKey) ?? {
      key: branchKey,
      categoryId,
      dguids,
      communityName: getArchiveCommunityName(submission, profilesByDguid),
      versions: [],
    };

    existing.versions.push({
      id: String(submission.id),
      versionId: record.versionId ?? null,
      branchId: record.branchId ?? null,
      resourceVersion: record.resourceVersion ?? 1,
      record,
      submission,
      mergedAt: record.mergedAt ?? submission.updated_at ?? submission.created_at,
      mergedBy: record.mergedBy ?? "Unknown commissioner",
    });
    category.branches.set(branchKey, existing);
  });

  return ARCHIVE_CATEGORY_DEFINITIONS.map((definition) => {
    const category = categoriesById.get(definition.id);
    const branches = [...category.branches.values()]
      .map((branch) => {
        const versions = branch.versions.sort((left, right) => {
          const leftVersion = Number(left.record?.versionNumber);
          const rightVersion = Number(right.record?.versionNumber);
          if (leftVersion && rightVersion) return leftVersion - rightVersion;
          return compareDates(left, right);
        }).map((version, index) => {
          const versionNumber = Number(version.record?.versionNumber) || index + 1;
          return {
            ...version,
            versionNumber,
            label: `v${versionNumber}`,
          };
        });
        const persistedLatest = versions.find((version) => version.record?.isLatest);
        const overriddenId = String(latestOverrides?.[branch.key] ?? "");
        const latestVersion = persistedLatest
          ?? versions.find((version) => version.id === overriddenId)
          ?? versions.at(-1)
          ?? null;

        return {
          ...branch,
          branchId: branch.versions.find((entry) => entry.branchId)?.branchId ?? null,
          resourceVersion: branch.versions.find((entry) => entry.resourceVersion)?.resourceVersion ?? 1,
          versions,
          latestVersion,
          label: branch.dguids.join(" / ") || versions[0]?.id || "Unknown branch",
        };
      })
      .sort((left, right) => {
        const dateDifference = compareDates(right.latestVersion, left.latestVersion);
        return dateDifference || left.label.localeCompare(right.label);
      });

    return { ...definition, branches, count: branches.length };
  });
}

export function filterArchiveTree(categories, query) {
  const target = String(query ?? "").trim().toLowerCase();
  if (!target) return categories;

  return categories.map((category) => ({
    ...category,
    branches: category.branches.filter((branch) => {
      const searchText = [
        branch.label,
        branch.communityName,
        ...branch.versions.flatMap((version) => [
          version.id,
          version.submission?.title,
          version.submission?.comment,
        ]),
      ].filter(Boolean).join(" ").toLowerCase();
      return searchText.includes(target);
    }),
  }));
}

export function findArchiveVersion(categories, submissionId) {
  const target = String(submissionId ?? "");
  for (const category of categories ?? []) {
    for (const branch of category.branches ?? []) {
      const version = branch.versions.find((entry) => entry.id === target);
      if (version) return { category, branch, version };
    }
  }
  return null;
}

export function archiveSubmissionIcon(type) {
  const normalized = normalizeArchiveType(type);
  if (normalized === "counter-proposal") return GitCompareArrows;
  if (normalized === "objection") return Flag;
  return MessageSquareText;
}
