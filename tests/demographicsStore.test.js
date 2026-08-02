import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "@jest/globals";
import { createStatisticsStore } from "../server/lib/demographics/statisticsStore.js";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function fixture({ value = 0, status = "available" } = {}) {
  const catalog = {
    schemaVersion: 1,
    groups: [{ id: "population", label: "Population" }],
    indicators: [{
      id: "population", group: "population", label: "Population", unit: "persons",
      decimals: 0, universe: "Population, 2021", sourceCharacteristicId: "1", statisticCode: "1",
    }],
  };
  const records = {
    "2021S051210010165": {
      quality: { dataQualityFlag: "00000", tnrShortForm: 0, tnrLongForm: 1.4, warning: null },
      values: [[value, status, null, null]],
    },
  };
  const index = {
    schemaVersion: 1,
    dataset: { censusYear: 2021, dataflow: "DF_DA", version: "1.3" },
    catalogSha256: hash(catalog),
    recordCount: 1,
    recordsSha256: hash(records),
    records,
  };
  return { catalog, index };
}

function storeFor(values, calls = []) {
  return createStatisticsStore({
    catalogPath: "catalog",
    indexPath: "index",
    async readFile(path) {
      calls.push(path);
      return JSON.stringify(path === "catalog" ? values.catalog : values.index);
    },
  });
}

test("statistics store preserves a real zero, expands source semantics, and memoizes the index", async () => {
  const calls = [];
  const store = storeFor(fixture(), calls);
  const first = await store.get("2021S051210010165");
  const second = await store.get("2021S051210010165");
  assert.equal(first.payload.groups[0].items[0].value, 0);
  assert.equal(first.payload.groups[0].items[0].status, "available");
  assert.equal(first.payload.availability, "available");
  assert.equal(first.etag, second.etag);
  assert.deepEqual(calls, ["catalog", "index"]);
});

test("statistics store distinguishes unknown, invalid, and known unavailable DAs", async () => {
  const store = storeFor(fixture({ value: null, status: "suppressed" }));
  assert.equal(await store.get("../../secret"), null);
  assert.equal(await store.get("2021S051299999999"), null);
  const result = await store.get("2021S051210010165");
  assert.equal(result.payload.availability, "unavailable");
  assert.equal(result.payload.groups[0].items[0].status, "suppressed");
});

test("statistics store refuses a corrupt checksum and retries loading after failure", async () => {
  const values = fixture();
  values.index.recordsSha256 = "corrupt";
  const calls = [];
  const store = storeFor(values, calls);
  await assert.rejects(store.get("2021S051210010165"), /checksum/i);
  await assert.rejects(store.get("2021S051210010165"), /checksum/i);
  assert.equal(calls.length, 4);
});
