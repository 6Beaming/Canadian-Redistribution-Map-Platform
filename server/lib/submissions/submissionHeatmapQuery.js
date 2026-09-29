import { resolveCommissionerPruid } from "../authorization/provinceCatalog.js";

/** Match the Dashboard area cards across all dates, without loading table metadata. */
export async function getCommissionerSubmissionHeatmap(supabase, { actorProfile } = {}) {
  const pruid = resolveCommissionerPruid(actorProfile);
  if (!pruid) {
    const error = new Error("Commissioner province registration is required.");
    error.statusCode = 403;
    throw error;
  }
  const countsByDguid = {};
  let cursor = null;
  while (true) {
    let query = supabase.from("submissions")
      .select("id,dguid,neighboring_dguid,submission_scope_pruids!inner(pruid)")
      .eq("submission_scope_pruids.pruid", pruid)
      .in("status", ["pending", "archive-request"])
      .order("id", { ascending: true })
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      for (const dguid of new Set([row.dguid, row.neighboring_dguid].filter(Boolean))) {
        countsByDguid[dguid] = (countsByDguid[dguid] ?? 0) + 1;
      }
    }
    cursor = data[data.length - 1].id;
  }
  return { countsByDguid, operatingPruid: pruid };
}
