import assert from "node:assert/strict";
import http from "node:http";
import { test } from "@jest/globals";
import express from "express";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { createRealtimeHarnessRouter } from "../../server/routes/realtimeHarness.js";

async function withHarness({ role = "commissioner" } = {}, callback) {
  const store = new SyntheticRealtimeEventStore();
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.user = { id: "commissioner-1" };
    request.profile = {
      id: "commissioner-1",
      province: "MB",
      role,
    };
    next();
  });
  app.use("/api/realtime/harness", createRealtimeHarnessRouter(store));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback({ baseUrl, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  return { body: await response.json(), status: response.status };
}

test("Commissioner harness commits ordered invalidations and refetches authoritative HTTP state", async () => {
  await withHarness({}, async ({ baseUrl, store }) => {
    const initial = await request(baseUrl, "/api/realtime/harness/resource");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.resource.updatedAt, null);
    assert.equal(initial.body.resource.value, 0);
    assert.equal(initial.body.resource.version, 0);
    assert.equal(initial.body.scope.pruid, "46");

    const commit = await request(baseUrl, "/api/realtime/harness/mutations", {
      body: JSON.stringify({ commit: true, count: 2 }),
      method: "POST",
    });
    assert.equal(commit.status, 201);
    assert.equal(commit.body.emittedEventIds.length, 2);
    assert.equal(commit.body.resource.version, 2);
    assert.deepEqual(store.deliveries.map(({ event }) => event.sequence), [1, 2]);
    assert.equal("value" in store.deliveries[0].event, false);

    const refetched = await request(baseUrl, "/api/realtime/harness/resource");
    assert.equal(refetched.body.resource.value, 2);
    assert.equal(refetched.body.resource.version, 2);
  });
});

test("rolled-back harness mutation changes no state and emits no event", async () => {
  await withHarness({}, async ({ baseUrl, store }) => {
    const rollback = await request(baseUrl, "/api/realtime/harness/mutations", {
      body: JSON.stringify({ commit: false, count: 1 }),
      method: "POST",
    });
    assert.equal(rollback.status, 409);
    assert.equal(rollback.body.committed, false);
    assert.equal(rollback.body.emittedEventIds.length, 0);
    assert.equal(store.deliveries.length, 0);
    assert.equal(store.readResource("46").version, 0);
  });
});

test("public-user profile cannot access the Commissioner harness", async () => {
  await withHarness({ role: "public_user" }, async ({ baseUrl }) => {
    const response = await request(baseUrl, "/api/realtime/harness/resource");
    assert.equal(response.status, 403);
    assert.match(response.body.error, /Commissioners only/u);
  });
});
