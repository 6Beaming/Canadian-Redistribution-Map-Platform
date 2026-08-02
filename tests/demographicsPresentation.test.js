import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  formatDemographicValue,
  getDemographicStatusLabel,
} from "../src/lib/demographics/demographicsPresentation.js";

test("demographic presentation preserves numeric zero and formats declared units", () => {
  assert.equal(formatDemographicValue({ status: "available", value: 0, decimals: 1, unit: "%" }, "en-CA"), "0.0%");
  assert.equal(formatDemographicValue({ status: "available", value: 1250, decimals: 0, unit: "$" }, "en-CA"), "$1,250");
  assert.equal(formatDemographicValue({ status: "available", value: 17.5, decimals: 1, unit: "persons/km²" }, "en-CA"), "17.5 persons/km²");
});

test("demographic presentation keeps missing states distinct from a real zero", () => {
  assert.equal(formatDemographicValue({ status: "suppressed", value: 0, decimals: 0, unit: "persons" }), null);
  assert.equal(getDemographicStatusLabel("suppressed"), "Suppressed by Statistics Canada");
  assert.equal(getDemographicStatusLabel("not_applicable"), "Not applicable");
  assert.equal(getDemographicStatusLabel("unavailable"), "Unavailable");
});
