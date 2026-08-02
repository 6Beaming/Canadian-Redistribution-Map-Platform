export const LIGHTWEIGHT_SUBMISSION_COLUMNS = [
  "id",
  "user_id",
  "type",
  "fed_num",
  "dguid",
  "neighboring_dguid",
  "title",
  "status",
  "created_at",
  "updated_at",
].join(",");

const ALLOWED_TYPES = new Set(["feedback", "objection", "counter-proposal"]);
const ALLOWED_STATUSES = new Set([
  "pending",
  "archive-request",
  "accepted",
  "rejected",
  "archived",
]);
const ALLOWED_SORTS = new Set(["newest", "oldest", "title-asc", "title-desc"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSubmissionType(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  if (normalized === "comment") return "feedback";
  return normalized;
}

export function normalizeSubmissionStatus(value) {
  const normalized = String(value ?? "pending")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");
  if (["approved", "addressed"].includes(normalized)) return "accepted";
  if (["archive-requested"].includes(normalized)) return "archive-request";
  if (["archive", "achived"].includes(normalized)) return "archived";
  return ALLOWED_STATUSES.has(normalized) ? normalized : "pending";
}

function normalizeSearchQuery(value) {
  const query = String(value ?? "").trim().replace(/\s+/gu, " ");
  return [...query].slice(0, 100).join("");
}

function normalizeDate(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (!DATE_PATTERN.test(normalized)) {
    const error = new Error(`${name} must use YYYY-MM-DD.`);
    error.statusCode = 400;
    throw error;
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    const error = new Error(`${name} is not a valid calendar date.`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function normalizeAllowlisted(value, allowed) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
  return allowed.has(normalized) ? normalized : "";
}

export function normalizeSubmissionListFilters(query = {}) {
  return {
    query: normalizeSearchQuery(query.query),
    createdFrom: normalizeDate(query.createdFrom, "createdFrom"),
    createdTo: normalizeDate(query.createdTo, "createdTo"),
    type: normalizeAllowlisted(query.type, ALLOWED_TYPES),
    status: normalizeAllowlisted(query.status, ALLOWED_STATUSES),
    sort: normalizeAllowlisted(query.sort, ALLOWED_SORTS) || "newest",
  };
}

function searchableText(row) {
  return [
    row.id,
    row.title,
    row.type,
    row.status,
    row.fed_num,
    row.dguid,
    row.neighboring_dguid,
    row.profile?.email,
    row.authorEmail,
    row.dissemination_areas?.community_name,
  ].map((value) => String(value ?? "").toLocaleLowerCase()).join(" ");
}

export function filterAndSortSubmissionRows(rows = [], filters) {
  const from = filters.createdFrom ? Date.parse(`${filters.createdFrom}T00:00:00.000Z`) : null;
  const toExclusive = filters.createdTo
    ? Date.parse(`${filters.createdTo}T00:00:00.000Z`) + 24 * 60 * 60 * 1000
    : null;
  const needle = filters.query.toLocaleLowerCase();

  const filtered = rows.filter((row) => {
    const createdAt = Date.parse(row.created_at);
    const type = normalizeSubmissionType(row.type);
    const status = normalizeSubmissionStatus(row.status);
    if (needle && !searchableText(row).includes(needle)) return false;
    if (filters.type && type !== filters.type) return false;
    if (filters.status && status !== filters.status) return false;
    if (from !== null && (!Number.isFinite(createdAt) || createdAt < from)) return false;
    if (toExclusive !== null && (!Number.isFinite(createdAt) || createdAt >= toExclusive)) return false;
    return true;
  });

  return filtered.sort((left, right) => {
    if (filters.sort === "title-asc" || filters.sort === "title-desc") {
      const result = String(left.title ?? "").localeCompare(String(right.title ?? ""), undefined, {
        sensitivity: "base",
      });
      if (result !== 0) return filters.sort === "title-asc" ? result : -result;
    } else {
      const result = Date.parse(right.created_at) - Date.parse(left.created_at);
      if (result !== 0) return filters.sort === "oldest" ? -result : result;
    }
    return String(right.id ?? "").localeCompare(String(left.id ?? ""));
  });
}

export function serializeLightweightSubmission(row, profile = null) {
  return {
    id: row.id,
    user_id: row.user_id,
    type: normalizeSubmissionType(row.type),
    fed_num: row.fed_num ?? null,
    dguid: row.dguid ?? null,
    neighboring_dguid: row.neighboring_dguid ?? null,
    title: row.title ?? "",
    status: normalizeSubmissionStatus(row.status),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    primary_fed_num: row.primary_fed_num ?? row.fed_num ?? null,
    secondary_fed_num: row.secondary_fed_num ?? row.primary_fed_num ?? row.fed_num ?? null,
    primary_population: Number.isFinite(Number(row.primary_population)) ? Number(row.primary_population) : null,
    secondary_population: Number.isFinite(Number(row.secondary_population)) ? Number(row.secondary_population) : null,
    dissemination_areas: {
      community_name: row.dissemination_areas?.community_name ?? "Unknown",
    },
    profile: profile ? { id: profile.id, email: profile.email } : null,
    authorEmail: profile?.email ?? null,
  };
}
