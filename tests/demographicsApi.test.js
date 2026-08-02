import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  clearDaStatisticsCache,
  getDaStatistics,
} from "../src/services/demographicsApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearDaStatisticsCache();
  globalThis.fetch = originalFetch;
});

test("demographics client caches one-DA responses and supports a forced retry", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ dguid: "2021S051210010165", call: calls.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const controller = new AbortController();
  const first = await getDaStatistics("2021S051210010165", { signal: controller.signal });
  const cached = await getDaStatistics("2021S051210010165");
  const forced = await getDaStatistics("2021S051210010165", { force: true });
  assert.strictEqual(cached, first);
  assert.equal(forced.call, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.match(calls[0].url, /\/api\/map\/da\/2021S051210010165\/statistics$/);
});

test("demographics client does not cache failed responses", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "Local index unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  };
  await assert.rejects(getDaStatistics("2021S051210010165"), /Local index unavailable/);
  await assert.rejects(getDaStatistics("2021S051210010165"), /Local index unavailable/);
  assert.equal(calls, 2);
});
