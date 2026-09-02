import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { getArchiveRequestForSubmission } from "../lib/archiveRequests/service.js";

const router = Router();
const LABEL_MIGRATION_ERROR = "Workspace label migration is not installed.";
const STANDARD_WORKSPACE_LABELS = Object.freeze([
  { id: "discussion-required", name: "Discussion Required", color: "#f4b400", custom: false },
  { id: "constructive", name: "Constructive", color: "#0f9d58", custom: false },
  { id: "worth-to-achieve", name: "Worth to Achieve", color: "#1a73e8", custom: false },
  { id: "negligible", name: "Negligible", color: "#f57c00", custom: false },
  { id: "over-aggressive", name: "Over Aggressive", color: "#ea4335", custom: false },
]);
const STANDARD_WORKSPACE_LABEL_KEYS = new Set(
  STANDARD_WORKSPACE_LABELS.map((label) => label.id),
);

function isLabelMigrationError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return ["42P01", "42883", "PGRST202", "PGRST205"].includes(code)
    || message.includes("workspace_labels.catalog_id")
    || message.includes("set_workspace_labels")
    || message.includes("set_submission_workspace_labels")
    || (code === "42703" && (
      message.includes("workspace_labels.is_selected")
      || message.includes("workspace_labels.label_key")
    ));
}

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    return res.status(403).json({ error: "Commissioner access is required." });
  }
  return next();
}

router.use(requireCommissioner);

function serializeComment(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    content: row.content,
    action: row.action ?? null,
    isClosing: Boolean(row.is_closing),
    authorId: row.author_id,
    email: row.profiles?.email ?? row.email ?? "Unknown",
    createdAt: row.created_at,
  };
}

function serializeLabel(row) {
  const standardKey = row.label_key ?? (
    row.is_custom ? null : STANDARD_WORKSPACE_LABELS.find((label) => label.name === row.name)?.id ?? null
  );
  return {
    id: row.id,
    catalogId: row.catalog_id ?? null,
    key: standardKey,
    submissionId: row.submission_id,
    name: row.name,
    color: row.color,
    custom: Boolean(row.is_custom),
    selected: row.is_selected !== false,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function serializeCatalog(row) {
  return {
    id: row.id,
    submissionId: row.submission_id ?? null,
    name: row.name,
    color: row.color,
    custom: Boolean(row.is_custom),
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeText(value, { field, max = 5000 }) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error(`${field} is required.`);
    error.statusCode = 400;
    throw error;
  }
  return [...normalized].slice(0, max).join("");
}

async function requireSubmission(supabase, submissionId) {
  const { data, error } = await supabase
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

router.get("/comments/:submissionId", async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase
    .from("workspace_comments")
    .select("id,submission_id,content,action,is_closing,created_at,author_id,profiles!author_id(email)")
    .eq("submission_id", req.params.submissionId)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data ?? []).map(serializeComment));
});

router.post("/comments", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const submissionId = String(req.body?.submissionId ?? "").trim();
    const content = normalizeText(req.body?.content, { field: "Comment", max: 5000 });
    if (!submissionId || !(await requireSubmission(supabase, submissionId))) {
      return res.status(404).json({ error: "Submission not found." });
    }
    const { data, error } = await supabase.from("workspace_comments").insert({
      submission_id: submissionId,
      author_id: req.user.id,
      content,
      action: String(req.body?.action ?? "").trim() || null,
      is_closing: Boolean(req.body?.is_closing),
    }).select("id,submission_id,content,action,is_closing,created_at,author_id").single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(serializeComment({ ...data, email: req.profile.email }));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.patch("/comments/:commentId", async (req, res) => {
  try {
    const content = normalizeText(req.body?.content, { field: "Comment", max: 5000 });
    const supabase = getSupabaseAdminDataClient();
    const { data, error } = await supabase.from("workspace_comments").update({
      content,
      action: String(req.body?.action ?? "").trim() || null,
      is_closing: Boolean(req.body?.is_closing),
    }).eq("id", req.params.commentId).eq("author_id", req.user.id)
      .select("id,submission_id,content,action,is_closing,created_at,author_id").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Comment not found or not editable." });
    return res.json(serializeComment({ ...data, email: req.profile.email }));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete("/comments/:commentId", async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.from("workspace_comments").delete()
    .eq("id", req.params.commentId).eq("author_id", req.user.id)
    .select("id,submission_id").maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Comment not found or not deletable." });
  return res.json({ deletedId: data.id, submissionId: data.submission_id });
});

router.get("/labels/:submissionId", async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.from("workspace_labels")
    // Select the row shape rather than naming catalog_id so a deployment that
    // has not applied the CP5 migration can still open Workspace read-only.
    .select("*")
    .eq("submission_id", req.params.submissionId)
    .order("updated_at", { ascending: true });
  if (error) {
    return res.status(isLabelMigrationError(error) ? 503 : 500).json({
      error: isLabelMigrationError(error) ? LABEL_MIGRATION_ERROR : error.message,
    });
  }

  return res.json((data ?? []).filter((row) => row.is_selected !== false).map(serializeLabel));
});

router.put("/labels/:submissionId", async (req, res) => {
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
  const normalized = labels.map((label) => ({
    id: String(label.id ?? "").trim(),
    key: String(label.key ?? label.catalogId ?? label.id ?? "").trim(),
    name: String(label.name ?? "").trim(),
    color: String(label.color ?? "").trim(),
    custom: Boolean(label.custom),
  })).filter((label) => label.key && label.name && label.color);
  if (normalized.length !== labels.length) {
    return res.status(400).json({ error: "Every label must have an identity, name, and color." });
  }
  if (normalized.some((label) => !label.custom && !STANDARD_WORKSPACE_LABEL_KEYS.has(label.key))) {
    return res.status(400).json({ error: "Unknown fixed Workspace label." });
  }
  const labelKeys = normalized.map((label) => label.custom ? label.id : label.key);
  if (new Set(labelKeys).size !== labelKeys.length) {
    return res.status(400).json({ error: "A label can only be assigned once." });
  }
  const supabase = getSupabaseAdminDataClient();
  if (!(await requireSubmission(supabase, req.params.submissionId))) {
    return res.status(404).json({ error: "Submission not found." });
  }
  const { data, error } = await supabase.rpc("checkpoint0_set_submission_workspace_labels", {
    target_submission_id: req.params.submissionId,
    target_updated_by: req.user.id,
    target_labels: normalized,
  });
  if (error) {
    const unavailable = isLabelMigrationError(error);
    return res.status(unavailable ? 503 : 500).json({
      error: unavailable
        ? LABEL_MIGRATION_ERROR
        : error.message,
    });
  }
  return res.json((data ?? []).map(serializeLabel));
});

router.delete("/labels/:labelId", async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.from("workspace_labels").delete()
    .eq("id", req.params.labelId)
    .select("id,submission_id").maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Label assignment not found." });
  return res.json({ deletedId: data.id, submissionId: data.submission_id });
});

router.get("/label-catalog", async (req, res) => {
  const submissionId = String(req.query?.submissionId ?? "").trim();
  if (!submissionId) return res.status(400).json({ error: "submissionId is required." });
  const supabase = getSupabaseAdminDataClient();
  if (!(await requireSubmission(supabase, submissionId))) {
    return res.status(404).json({ error: "Submission not found." });
  }
  const { data, error } = await supabase.from("workspace_labels")
    .select("id,submission_id,name,color,is_custom,updated_by,updated_at")
    .eq("submission_id", submissionId)
    .eq("is_custom", true)
    .order("updated_at", { ascending: true });
  if (error) {
    return res.status(isLabelMigrationError(error) ? 503 : 500).json({
      error: isLabelMigrationError(error) ? LABEL_MIGRATION_ERROR : error.message,
    });
  }
  return res.json([
    ...STANDARD_WORKSPACE_LABELS,
    ...(data ?? []).map((row) => serializeCatalog({
      ...row,
      created_by: row.updated_by,
      created_at: row.updated_at,
    })),
  ]);
});

router.post("/label-catalog", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const submissionId = String(req.body?.submissionId ?? "").trim();
    if (!submissionId || !(await requireSubmission(supabase, submissionId))) {
      return res.status(404).json({ error: "Submission not found." });
    }
    const name = normalizeText(req.body?.name, { field: "Label name", max: 30 });
    const color = normalizeText(req.body?.color, { field: "Label color", max: 64 });
    const { data, error } = await supabase.from("workspace_labels").insert({
      submission_id: submissionId,
      name,
      color,
      is_custom: true,
      is_selected: false,
      updated_by: req.user.id,
    }).select("id,submission_id,name,color,is_custom,updated_by,updated_at").single();
    if (error) {
      if (isLabelMigrationError(error)) return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
      return res.status(error.code === "23505" ? 409 : 500).json({ error: error.message });
    }
    return res.status(201).json(serializeCatalog({
      ...data,
      created_by: data.updated_by,
      created_at: data.updated_at,
    }));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.patch("/label-catalog/:labelId", async (req, res) => {
  try {
    const submissionId = String(req.body?.submissionId ?? "").trim();
    if (!submissionId) return res.status(400).json({ error: "submissionId is required." });
    const updates = { updated_at: new Date().toISOString() };
    if (Object.hasOwn(req.body ?? {}, "name")) {
      updates.name = normalizeText(req.body.name, { field: "Label name", max: 30 });
    }
    if (Object.hasOwn(req.body ?? {}, "color")) {
      updates.color = normalizeText(req.body.color, { field: "Label color", max: 64 });
    }
    const supabase = getSupabaseAdminDataClient();
    const { data, error } = await supabase.from("workspace_labels").update(updates)
      .eq("id", req.params.labelId)
      .eq("submission_id", submissionId)
      .eq("is_custom", true)
      .select("id,submission_id,name,color,is_custom,updated_by,updated_at").maybeSingle();
    if (error) {
      if (isLabelMigrationError(error)) return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
      return res.status(error.code === "23505" ? 409 : 500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: "Catalog label not found." });
    return res.json(serializeCatalog({
      ...data,
      created_by: data.updated_by,
      created_at: data.updated_at,
    }));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete("/label-catalog/:labelId", async (req, res) => {
  const submissionId = String(req.query?.submissionId ?? "").trim();
  if (!submissionId) return res.status(400).json({ error: "submissionId is required." });
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.from("workspace_labels").delete()
    .eq("id", req.params.labelId)
    .eq("submission_id", submissionId)
    .eq("is_custom", true)
    .select("id").maybeSingle();
  if (error) {
    if (isLabelMigrationError(error)) {
      return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
    }
    return res.status(error.code === "23503" ? 409 : 500).json({
      error: error.code === "23503" ? "Remove this label from submissions before deleting it." : error.message,
    });
  }
  if (!data) return res.status(404).json({ error: "Custom catalog label not found." });
  return res.json({ deletedId: data.id });
});

router.get("/submissions/:submissionId/review-state", async (req, res) => {
  const submissionId = String(req.params.submissionId ?? "").trim();
  if (!submissionId) return res.status(400).json({ error: "submissionId is required." });
  const supabase = getSupabaseAdminDataClient();

  const [commentsResult, labelsResult, catalogResult, archiveRequest] = await Promise.all([
    supabase
      .from("workspace_comments")
      .select("id,submission_id,content,action,is_closing,created_at,author_id,profiles!author_id(email)")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false }),
    supabase.from("workspace_labels")
      .select("*")
      .eq("submission_id", submissionId)
      .order("updated_at", { ascending: true }),
    supabase.from("workspace_labels")
      .select("id,submission_id,name,color,is_custom,created_by,created_at,updated_at")
      .or(`submission_id.eq.${submissionId},submission_id.is.null`)
      .order("updated_at", { ascending: true }),
    getArchiveRequestForSubmission({
      supabase,
      submissionId,
      actorProfile: req.profile,
    }).catch((error) => {
      if (error.statusCode === 404) return null;
      throw error;
    }),
  ]);

  if (commentsResult.error) {
    return res.status(500).json({ error: commentsResult.error.message });
  }
  if (labelsResult.error) {
    if (isLabelMigrationError(labelsResult.error)) {
      return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
    }
    return res.status(500).json({ error: labelsResult.error.message });
  }
  if (catalogResult.error) {
    if (isLabelMigrationError(catalogResult.error)) {
      return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
    }
    return res.status(500).json({ error: catalogResult.error.message });
  }

  return res.json({
    comments: (commentsResult.data ?? []).map(serializeComment),
    labels: (labelsResult.data ?? []).filter((row) => row.is_selected !== false).map(serializeLabel),
    labelCatalog: (catalogResult.data ?? []).map(serializeCatalog),
    archiveRequest,
    collaborationWarning: "",
  });
});

export default router;
