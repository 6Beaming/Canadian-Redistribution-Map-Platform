import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "@jest/globals";

import { loadCurrentCanonicalRelease } from "../server/lib/map/canonicalReleaseStore.js";
import {
  resolveDguidRelationship,
  resolveFedRelationship,
} from "../server/lib/map/releaseScopeIndex.js";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const YT_PRUID = "60";
const IN_SCOPE_DGUID = "2021S051260010118";
const ADJACENT_DGUID = "2021S051259570228";
const OUT_OF_SCOPE_DGUID = "2021S051210010165";

test("release scope index classifies commissioner operating province relationships", () => {
  const release = loadCurrentCanonicalRelease();

  const inScope = resolveDguidRelationship(release, IN_SCOPE_DGUID, YT_PRUID);
  assert.equal(inScope.relationship, "in_scope");
  assert.equal(inScope.selectedArea.dguid, IN_SCOPE_DGUID);
  assert.deepEqual(inScope.inScopeNeighbors, []);

  const adjacent = resolveDguidRelationship(release, ADJACENT_DGUID, YT_PRUID);
  assert.equal(adjacent.relationship, "adjacent_to_scope");
  assert.ok(adjacent.inScopeNeighbors.some((neighbor) => neighbor.pruid === YT_PRUID));

  const outOfScope = resolveDguidRelationship(release, OUT_OF_SCOPE_DGUID, YT_PRUID);
  assert.equal(outOfScope.relationship, "out_of_scope");
  assert.deepEqual(outOfScope.inScopeNeighbors, []);
});

test("release scope index resolves FED relationships for commissioner province", () => {
  const release = loadCurrentCanonicalRelease();
  const inScopeFed = resolveFedRelationship(release, "60001", YT_PRUID);
  assert.equal(inScopeFed.relationship, "in_scope");
  assert.equal(inScopeFed.selectedFed.fedNum, "60001");

  const outOfScopeFed = resolveFedRelationship(release, "10002", YT_PRUID);
  assert.equal(outOfScopeFed.relationship, "out_of_scope");
});

test("map camera commands are one-shot and isolated from selection effects", () => {
  const hook = read("src/hooks/useMapCameraCommands.js");
  const mapCanvas = read("src/components/non_prebuilt/MapCanvas.jsx");
  const userHome = read("src/pages/UserHome.jsx");
  const dashboardHome = read("src/pages/DashboardHome.jsx");

  assert.match(hook, /requestId/);
  assert.match(hook, /source/);
  assert.match(mapCanvas, /consumedCameraRequestIdRef/);
  assert.match(mapCanvas, /cameraCommandRef/);
  assert.doesNotMatch(userHome, /effectiveMapSearchTarget/);
  assert.match(userHome, /useMapCameraCommands/);
  assert.match(dashboardHome, /useMapCameraCommands/);
});
