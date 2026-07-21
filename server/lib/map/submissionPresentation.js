import { getDaDisplayLabel } from "../../../src/lib/map/profileUtils.js";
import { loadProfileIndex } from "./mapAssetAuthority.js";

export function normalizeSubmissionType(value) {
  const type = String(value ?? "feedback").trim().toLowerCase();

  if (type === "counter_proposal") {
    return "counter-proposal";
  }

  if (type === "comment") {
    return "feedback";
  }

  return type;
}

export async function enrichSubmissionsWithDaMetadata(submissions = []) {
  if (!submissions.length) {
    return [];
  }

  const { index } = await loadProfileIndex();

  return submissions.map((submission) => {
    const profile = index.get(String(submission?.dguid ?? "").trim());
    const communityName =
      getDaDisplayLabel(profile)
      ?? submission?.dissemination_areas?.community_name
      ?? "Unknown";

    return {
      ...submission,
      type: normalizeSubmissionType(submission.type),
      dissemination_areas: {
        community_name: communityName,
      },
    };
  });
}
