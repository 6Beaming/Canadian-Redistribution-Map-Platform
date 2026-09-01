import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { jest, test } from "@jest/globals";
import app from "../server/app.js";

jest.setTimeout(120000);

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

function releaseFixture() {
  const mapRoot = path.resolve("src/data/map");
  const pointer = JSON.parse(fs.readFileSync(path.join(mapRoot, "current-release.json"), "utf8"));
  const root = path.join(mapRoot, "releases", pointer.releaseId);
  const pairs = JSON.parse(fs.readFileSync(path.join(root, "topology", "shared-arcs.index.json"), "utf8")).items;
  const pair = Object.keys(pairs).find((key) => pairs[key].length < 1_000_000) ?? Object.keys(pairs)[0];
  return { pointer, pair: pair.split("|") };
}

test("public immutable release routes random-read one DA pair and revalidate with ETag", async () => {
  const fixture = releaseFixture();
  await withServer(async (baseUrl) => {
    const current = await fetch(`${baseUrl}/api/map/releases/current`);
    assert.equal(current.status, 200);
    assert.match(current.headers.get("cache-control"), /no-cache/);
    const currentPayload = await current.json();
    assert.equal(currentPayload.releaseId, fixture.pointer.releaseId);
    assert.equal(currentPayload.manifestSha256, fixture.pointer.manifestSha256);

    const [first, second] = fixture.pair;
    const url = `${baseUrl}/api/map/releases/${fixture.pointer.releaseId}/da-pairs/${second}/${first}?representation=edit&lod=auto`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /immutable/);
    const tag = response.headers.get("etag");
    assert.ok(tag);
    const payload = await response.json();
    assert.equal(JSON.stringify(payload.requestedDguids), JSON.stringify([second, first]));
    assert.equal(JSON.stringify(payload.canonicalDguids), JSON.stringify([first, second].sort()));
    assert.equal(payload.features.features.length, 2);
    assert.equal(payload.representation, "edit");
    assert.ok(payload.sharedBoundary.features.length >= 1);
    assert.ok(payload.editableHandles.every(({ vertexId }) => /^v1_[0-9a-f]{24}$/.test(vertexId)));

    const cached = await fetch(url, { headers: { "If-None-Match": tag } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
  });
});

test("release routes reject unknown DAs and non-adjacent pairs without authentication", async () => {
  const fixture = releaseFixture();
  await withServer(async (baseUrl) => {
    const unknown = await fetch(`${baseUrl}/api/map/releases/${fixture.pointer.releaseId}/das/not-a-da`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, "Unknown or unavailable DA: not-a-da.");

    const invalid = await fetch(`${baseUrl}/api/map/releases/${fixture.pointer.releaseId}/da-pairs/${fixture.pair[0]}/${fixture.pair[0]}`);
    assert.equal(invalid.status, 400);
  });
});
