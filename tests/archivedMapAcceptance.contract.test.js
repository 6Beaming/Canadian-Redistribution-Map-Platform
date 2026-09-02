import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { afterEach, test } from "@jest/globals";
import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

afterEach(() => setSupabaseTestDoubles(null));

async function request(path, { cookie = "crmp_access_token=access-token" } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { cookie },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Archived Map InfoPanel exposes four projection modes and loads projections per DGUID", () => {
  const panel = read("src/components/non_prebuilt/ArchivedMapInfoPanel.jsx");
  const dashboard = read("src/pages/DashboardHome.jsx");
  const api = read("src/services/workspaceApi.js");

  assert.match(panel, /ARCHIVED_MAP_PANEL_VIEWS = \[[\s\S]*"all"[\s\S]*"comments"[\s\S]*"objections"[\s\S]*"counter-proposals"/);
  assert.match(panel, /getArchivedMapProjections\(selection\.dguid/);
  assert.match(dashboard, /initialArchivedMapEnabled \? \([\s\S]*<ArchivedMapInfoPanel/);
  assert.match(api, /\/api\/workspace\/archive-map\/projections\?/);
});

test("Archived Tree Super Root opens latest Archived Map with return state", () => {
  const archived = read("src/pages/ArchivedTree.jsx");
  const canvas = read("src/components/non_prebuilt/ArchivedTreeCanvas.jsx");

  assert.match(canvas, /type: "super-root"/);
  assert.match(archived, /onOpenSuperRootMap=\{\(\) => navigate\("\/dashboard\?archivedMap=1"/);
  assert.match(archived, /from: "\/dashboard\/archivedTree"/);
});

test("Archived Map keeps its category menu populated and always returns to Archived Tree", () => {
  const panel = read("src/components/non_prebuilt/ArchivedMapInfoPanel.jsx");
  const header = read("src/pages/Header.jsx");

  assert.match(panel, /All Archived Submissions/);
  assert.match(panel, /Comments/);
  assert.match(panel, /Boundary Objections/);
  assert.match(panel, /Counter-Proposals/);
  assert.match(panel, /aria-label="Choose archived submission category"/);
  assert.match(header, /pathname === "\/dashboard"[\s\S]*archivedMap"\) === "1"[\s\S]*return "\/dashboard\/archivedTree"/);
});

test("archive-map snapshot route returns revision and head descriptors", async () => {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: "c1" } }, error: null }) },
    }),
    getSupabaseProfile: async () => ({
      id: "c1",
      email: "c@example.com",
      role: "commissioner",
      province: "YT",
    }),
    getSupabaseAdminDataClient: () => ({
      from(table) {
        if (table === "archive_map_revisions") {
          return {
            select() { return this; },
            eq() { return this; },
            order() { return this; },
            limit() { return this; },
            maybeSingle() {
              return Promise.resolve({ data: { sequence: 5, release_id: "statscan-da-2021-r1" }, error: null });
            },
          };
        }
        if (table === "archive_map_da_heads") {
          return {
            select() { return this; },
            eq() { return this; },
            in() {
              return Promise.resolve({
                data: [{
                  dguid: "2021S051260010118",
                  uses_base: false,
                  display_geometry: { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { DGUID: "2021S051260010118" } },
                  geometry_digest: "sha256:abc",
                  resource_version: 2,
                  last_map_revision_sequence: 5,
                }],
                error: null,
              });
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    }),
  });

  const response = await request("/api/workspace/archive-map?dguids=2021S051260010118");
  assert.equal(response.status, 200);
  assert.equal(response.body.archiveMapRevision, 5);
  assert.equal(response.body.heads.length, 1);
  assert.equal(response.body.heads[0].dguid, "2021S051260010118");
  assert.equal(response.body.heads[0].usesBase, false);
});
