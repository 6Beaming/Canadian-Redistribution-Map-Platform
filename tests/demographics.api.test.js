import assert from "node:assert/strict";
import http from "node:http";
import { test } from "@jest/globals";
import app from "../server/app.js";

async function withServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("public DA statistics returns only the requested local aggregate and supports ETag revalidation", async () => {
  await withServer(async (baseUrl) => {
    const url = `${baseUrl}/api/map/da/2021S051210010165/statistics`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /^public,/);
    const etag = response.headers.get("etag");
    assert.ok(etag);

    const payload = await response.json();
    assert.equal(payload.dguid, "2021S051210010165");
    assert.equal(payload.dataset.dataflow, "DF_DA");
    assert.equal(payload.dataset.version, "1.3");
    assert.equal(payload.groups.length, 9);
    assert.equal(payload.groups.reduce((count, group) => count + group.items.length, 0), 30);
    assert.equal(JSON.stringify(payload).includes("geometry"), false);
    assert.equal(JSON.stringify(payload).includes("records"), false);

    const cached = await fetch(url, { headers: { "If-None-Match": etag } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
  });
});

test("public DA statistics rejects invalid and unknown DGUIDs without authentication", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/map/da/not-a-dguid/statistics`);
    assert.equal(invalid.status, 404);
    assert.equal((await invalid.json()).error, "DA statistics were not found.");

    const unknown = await fetch(`${baseUrl}/api/map/da/2021S051299999999/statistics`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, "DA statistics were not found.");
  });
});
