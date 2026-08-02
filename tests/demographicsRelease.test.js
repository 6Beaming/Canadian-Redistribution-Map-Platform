import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "@jest/globals";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "src/data/map/indexes/da_demographics_index.json");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("checked-in demographics release covers every local DA and validates its deterministic payload", () => {
  const profiles = readJson("src/data/map/indexes/da_profile_index.json").profiles;
  const catalog = readJson("src/data/map/indexes/da_demographics_catalog.json");
  const index = readJson("src/data/map/indexes/da_demographics_index.json");
  const coverage = readJson("src/data/map/indexes/da_demographics_coverage.json");

  const profileDguids = Object.keys(profiles).sort();
  const releaseDguids = Object.keys(index.records).sort();
  assert.equal(catalog.indicators.length, 30);
  assert.equal(index.recordCount, 20_374);
  assert.equal(coverage.targetDguidCount, 20_374);
  assert.equal(coverage.recordCount, 20_374);
  assert.deepEqual(releaseDguids, profileDguids);
  assert.equal(new Set(catalog.indicators.map((indicator) => indicator.id)).size, 30);
  assert.equal(releaseDguids.every((dguid) => index.records[dguid].values.length === 30), true);
  assert.equal(index.catalogSha256, sha256(stableStringify(catalog)));
  assert.equal(index.recordsSha256, sha256(stableStringify(index.records)));
  assert.equal(
    index.dataset.sourceUrl,
    `https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/dataflow/STC_CP/DF_DA/${index.dataset.version}`,
  );
  assert.equal(coverage.dataset.sourceUrl, index.dataset.sourceUrl);
  assert.deepEqual(coverage.duplicateSeries, []);
  assert.ok(fs.statSync(INDEX_PATH).size < 25 * 1024 * 1024);
});
