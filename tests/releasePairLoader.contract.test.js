import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "@jest/globals";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("UserHome loads objection and counter-proposal geometry through release pair routes", () => {
  const userHome = read("src/pages/UserHome.jsx");
  const loader = read("src/lib/map/releasePairLoader.js");
  const mapApi = read("src/services/mapApi.js");

  assert.match(loader, /getReleaseDaPair/);
  assert.match(loader, /representation: "edit"/);
  assert.match(loader, /representation: "display"/);
  assert.match(mapApi, /pairCacheKey|pair:\$\{releaseId\}/);
  assert.match(userHome, /loadDisplayDaIndex/);
  assert.match(userHome, /loadDisplayPairIndex/);
  assert.match(userHome, /loadCounterProposalPair/);
  assert.doesNotMatch(userHome, /getMetadataGeojsonPathsForFed/);
  assert.doesNotMatch(userHome, /ensureMetadataIndexForFed/);
});
