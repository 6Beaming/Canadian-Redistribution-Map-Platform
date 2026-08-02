import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";

const router = Router();
const LABEL_MIGRATION_ERROR = "Workspace label migration is not installed.";

function isLabelMigrationError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return ["42P01", "42703", "42883", "PGRST202", "PGRST205"].includes(code)
    || message.includes("workspace_labels.catalog_id")
    || message.includes("set_workspace_labels")
    || message.includes("workspace_label_catalog");
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
  return {
    id: row.id,
    catalogId: row.catalog_id ?? null,
    submissionId: row.submission_id,
    name: row.name,
    color: row.color,
    custom: Boolean(row.is_custom),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function serializeCatalog(row) {
  return {
    id: row.id,
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

  let rows = data ?? [];
  const usesLegacyAssignments = rows.some((row) => !("catalog_id" in row));
  if (usesLegacyAssignments) {
    const { data: catalogRows, error: catalogError } = await supabase
      .from("workspace_label_catalog")
      .select("id,name,color")
      .order("created_at", { ascending: true });

    // The legacy assignment table has no stable catalog identity. Match its
    // saved presentation to the catalog for read compatibility only. Writes
    // continue to require the atomic migration/RPC below.
    if (!catalogError) {
      const byPresentation = new Map((catalogRows ?? []).map((catalog) => [
        `${String(catalog.name).trim().toLowerCase()}\u0000${catalog.color}`,
        catalog.id,
      ]));
      rows = rows.map((row) => ({
        ...row,
        catalog_id: byPresentation.get(
          `${String(row.name).trim().toLowerCase()}\u0000${row.color}`,
        ) ?? null,
      }));
    }
    res.set("X-Workspace-Label-Schema", "legacy-read-only");
  }

  return res.json(rows.map(serializeLabel));
});

router.put("/labels/:submissionId", async (req, res) => {
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
  const normalized = labels.map((label) => ({
    catalogId: String(label.catalogId ?? label.id ?? "").trim(),
    name: String(label.name ?? "").trim(),
    color: String(label.color ?? "").trim(),
    custom: Boolean(label.custom),
  })).filter((label) => label.catalogId && label.name && label.color);
  if (normalized.length !== labels.length) {
    return res.status(400).json({ error: "Every label must have a catalog identity, name, and color." });
  }
  const catalogIds = normalized.map((label) => label.catalogId);
  if (new Set(catalogIds).size !== catalogIds.length) {
    return res.status(400).json({ error: "A catalog label can only be assigned once." });
  }
  const supabase = getSupabaseAdminDataClient();
  if (!(await requireSubmission(supabase, req.params.submissionId))) {
    return res.status(404).json({ error: "Submission not found." });
  }
  const { data, error } = await supabase.rpc("set_workspace_labels", {
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

router.get("/label-catalog", async (_req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.from("workspace_label_catalog")
    .select("id,name,color,is_custom,created_by,created_at,updated_at")
    .order("created_at", { ascending: true });
  if (error) {
    return res.status(isLabelMigrationError(error) ? 503 : 500).json({
      error: isLabelMigrationError(error) ? LABEL_MIGRATION_ERROR : error.message,
    });
  }
  return res.json((data ?? []).map(serializeCatalog));
});

router.post("/label-catalog", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const name = normalizeText(req.body?.name, { field: "Label name", max: 30 });
    const color = normalizeText(req.body?.color, { field: "Label color", max: 64 });
    const { data, error } = await supabase.from("workspace_label_catalog").insert({
      name,
      color,
      is_custom: Boolean(req.body?.custom),
      created_by: req.user.id,
    }).select("id,name,color,is_custom,created_by,created_at,updated_at").single();
    if (error) {
      if (isLabelMigrationError(error)) return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
      return res.status(error.code === "23505" ? 409 : 500).json({ error: error.message });
    }
    return res.status(201).json(serializeCatalog(data));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.patch("/label-catalog/:labelId", async (req, res) => {
  try {
    const updates = { updated_at: new Date().toISOString() };
    if (Object.hasOwn(req.body ?? {}, "name")) {
      updates.name = normalizeText(req.body.name, { field: "Label name", max: 30 });
    }
    if (Object.hasOwn(req.body ?? {}, "color")) {
      updates.color = normalizeText(req.body.color, { field: "Label color", max: 64 });
    }
    const supabase = getSupabaseAdminDataClient();
    const { data, error } = await supabase.from("workspace_label_catalog").update(updates)
      .eq("id", req.params.labelId)
      .select("id,name,color,is_custom,created_by,created_at,updated_at").maybeSingle();
    if (error) {
      if (isLabelMigrationError(error)) return res.status(503).json({ error: LABEL_MIGRATION_ERROR });
      return res.status(error.code === "23505" ? 409 : 500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: "Catalog label not found." });
    return res.json(serializeCatalog(data));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete("/label-catalog/:labelId", async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.from("workspace_label_catalog").delete()
    .eq("id", req.params.labelId).eq("is_custom", true)
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

export default router;
