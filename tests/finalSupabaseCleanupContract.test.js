import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";
import { addComment } from "../src/services/commentsApi.js";

const app = fs.readFileSync("server/app.js", "utf8");
const commentsRoute = fs.readFileSync("server/routes/comments.js", "utf8");
const commentsClient = fs.readFileSync("src/services/commentsApi.js", "utf8");
const cleanupPreparation = fs.readFileSync(
  "supabase/migrations/20260903050000_prepare_final_legacy_cleanup.sql",
  "utf8",
);
const cleanupContraction = fs.readFileSync(
  "supabase/migrations/20260903060000_drop_final_legacy_objects.sql",
  "utf8",
);

test("retired proposal and comment-tag contracts have no runtime consumer", () => {
  const activeSource = `${app}\n${commentsRoute}\n${commentsClient}`;
  assert.doesNotMatch(activeSource, /map_proposals|comment_tags|comment-tags/);
  assert.doesNotMatch(commentsRoute, /proposal_id|\/proposal\/:proposalId/);
  assert.doesNotMatch(commentsClient, /proposal_id|getCommentsForDA|getCommentTags|addCommentTag|deleteCommentTag/);
  assert.equal(fs.existsSync("server/routes/commentTags.js"), false);
  assert.match(commentsRoute, /getSupabaseAdminDataClient\(\)[\s\S]*from\("submissions"\)/);
});

test("Comment and Objection writes send only the current submission contract", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ id: "submission-1" }),
    };
  };

  try {
    await addComment(
      "Submission content",
      "60001",
      "2021S051260010251",
      "Submission title",
      null,
      "feedback",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(request.url, "/api/comments/");
  assert.deepEqual(JSON.parse(request.options.body), {
    comment: "Submission content",
    fed_num: "60001",
    dguid: "2021S051260010251",
    title: "Submission title",
    neighboring_dguid: null,
    type: "feedback",
  });
});

test("cleanup preparation detaches labels without dropping legacy tables", () => {
  assert.match(cleanupPreparation, /set catalog_id = null/i);
  assert.match(cleanupPreparation, /workspace_labels_local_identity_check/i);
  assert.match(cleanupPreparation, /drop function if exists public\.set_workspace_labels/i);
  assert.match(cleanupPreparation, /drop function if exists public\.sync_workspace_label_catalog_assignments/i);
  assert.doesNotMatch(cleanupPreparation, /drop table/i);
});

test("cleanup preparation restores the server-owned table boundary", () => {
  assert.match(cleanupPreparation, /alter table public\.%I enable row level security/i);
  assert.match(cleanupPreparation, /revoke all privileges on table public\.%I from anon, authenticated/i);
  assert.match(cleanupPreparation, /grant select, insert, update on table public\.profiles to authenticated/i);
  assert.match(cleanupPreparation, /revoke all on function public\.province_code_to_pruid\(text\)/i);
  assert.match(cleanupPreparation, /revoke all on function public\.submission_matches_commissioner_pruid/i);
});

test("replacement database audit covers all runtime tables and excludes the alias table", () => {
  for (const table of [
    "profiles",
    "workspace_comments",
    "workspace_labels",
    "realtime_outbox",
    "archive_map_da_heads",
  ]) {
    assert.match(cleanupPreparation, new RegExp(`\\('${table}'\\)`));
  }
  const replacement = cleanupPreparation.slice(
    cleanupPreparation.indexOf("create or replace function public.audit_final_refactor_database"),
  );
  assert.doesNotMatch(replacement, /map_release_legacy_aliases/);
  assert.match(replacement, /workspaceCatalogLinks/);
  assert.match(replacement, /workspaceFixedLabelsMissingKey/);
});

test("final cleanup contracts legacy objects without an uncontrolled cascade", () => {
  for (const table of [
    "audit_log",
    "comment_tags",
    "da_adjacency",
    "da_assignments",
    "fed_districts",
    "map_proposals",
    "map_release_legacy_aliases",
    "workspace_label_catalog",
  ]) {
    assert.match(cleanupContraction, new RegExp(`drop table if exists public\\.${table} restrict`, "i"));
  }
  assert.match(cleanupContraction, /drop column if exists proposal_id restrict/i);
  assert.match(cleanupContraction, /drop column if exists catalog_id restrict/i);
  assert.match(cleanupContraction, /drop function if exists public\.archive_branch_key\(jsonb, uuid\) restrict/i);
  assert.doesNotMatch(cleanupContraction, /\bcascade\b/i);
});

test("final cleanup has transactional data and dependency preflights", () => {
  assert.match(cleanupContraction, /begin;[\s\S]*commit;/i);
  assert.match(cleanupContraction, /public\.audit_final_refactor_database\(\)/i);
  assert.match(cleanupContraction, /submissions where proposal_id is not null/i);
  assert.match(cleanupContraction, /workspace_labels where catalog_id is not null/i);
  assert.match(cleanupContraction, /unexpected foreign-key dependencies/i);
  assert.match(cleanupContraction, /and source_class\.relname not in/i);
  assert.match(cleanupContraction, /workspaceCatalogLinks', 0/i);
});
