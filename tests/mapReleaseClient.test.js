import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";
import { mapApi } from "../src/services/mapApi.js";

afterEach(() => {
  mapApi.clearImmutableReleaseCache();
  jest.restoreAllMocks();
});

test("immutable pair requests canonicalize the pair and deduplicate in-flight fetches", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ canonicalDguids: ["a", "b"] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const [first, second] = await Promise.all([
    mapApi.getReleaseDaPair("release-1", "b", "a", { representation: "edit" }),
    mapApi.getReleaseDaPair("release-1", "a", "b", { representation: "edit" }),
  ]);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.deepEqual(first, second);
  assert.match(fetchMock.mock.calls[0][0], /\/a\/b\?representation=edit&lod=auto$/);
});

test("an aborted consumer stops awaiting a shared immutable request", async () => {
  let resolveFetch;
  jest.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => {
    resolveFetch = resolve;
  }));
  const controller = new AbortController();
  const pending = mapApi.getReleaseDa("release-1", "da-1", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  resolveFetch(new Response(JSON.stringify({ dguid: "da-1" }), { status: 200 }));
});

