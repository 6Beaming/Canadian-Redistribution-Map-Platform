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
    const secondaryProfile = index.get(String(submission?.neighboring_dguid ?? "").trim());
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
      primary_fed_num: profile?.fed_num ?? submission.fed_num ?? null,
      secondary_fed_num: secondaryProfile?.fed_num ?? null,
      primary_population: profile?.population ?? null,
      secondary_population: secondaryProfile?.population ?? null,
    };
  });
}
