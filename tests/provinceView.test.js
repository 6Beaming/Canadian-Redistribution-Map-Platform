import assert from "node:assert/strict";
import { test } from "@jest/globals";

import { getProvinceMapView } from "../src/lib/map/provinceView.js";

test("province map views normalize saved province codes", () => {
  const province = getProvinceMapView(" on ");

  assert.equal(province.code, "ON");
  assert.equal(province.name, "Ontario");
  assert.equal(province.pruid, "35");
  assert.deepEqual(province.mapTarget.viewport, [
    [-95.156021, 41.676951],
    [-74.320364, 56.861596],
  ]);
  assert.equal(province.mapTarget.showMarker, false);
});

test("province map views use bounds suitable for fitting small provinces", () => {
  const province = getProvinceMapView("PE");

  assert.equal(province.name, "Prince Edward Island");
  assert.equal(province.mapTarget.fitBoundsOptions.maxZoom, 8);
  assert.equal(province.mapTarget.fitBoundsOptions.padding, 48);
});

test("Yukon uses a closer camera so it occupies most of the wide map", () => {
  const province = getProvinceMapView("YT");

  assert.deepEqual(province.mapTarget.location, [-131.8, 62.4]);
  assert.equal(province.mapTarget.zoom, 5.3);
  assert.equal(province.mapTarget.viewport, undefined);
  assert.equal(province.mapTarget.showMarker, false);
});

test("invalid or missing province codes fall back to the caller's Canada view", () => {
  assert.equal(getProvinceMapView("XX"), null);
  assert.equal(getProvinceMapView(null), null);
});
