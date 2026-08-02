import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  buildCounterProposalCache,
  commitCounterProposalCacheHistory,
  readCounterProposalStorage,
  restoreCounterProposalCacheFromDraft,
  writeCounterProposalStorage,
} from "../src/lib/map/counterProposalWorkflow.js";
import {
  buildSharedBoundaryHandles,
  distanceMeters,
  filterHandlesForViewport,
} from "../src/lib/map/counterProposalHandles.js";
import { buildDaObjectionIndex } from "../src/lib/map/objectionWorkflow.js";
import {
  createCounterProposalWorkerState,
  processCounterProposalWorkerMessage,
} from "../src/lib/map/counterProposalWorkerDomain.js";
import { createCounterProposalWorkerClient } from "../src/services/counterProposalWorkerClient.js";
import { submitCounterProposalWithDraft } from "../src/lib/map/counterProposalSubmit.js";

function createPair() {
  const first = {
    type: "Feature",
    properties: { DGUID: "first", population: 1000 },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0]]] },
  };
  const second = {
    type: "Feature",
    properties: { DGUID: "second", population: 1000 },
    geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], [1, 0]]] },
  };
  const index = buildDaObjectionIndex({ type: "FeatureCollection", features: [first, second] });
  return buildCounterProposalCache(index, new Map([
    ["first", { population: 1000 }],
    ["second", { population: 1000 }],
  ]), "first", "second");
}

test("handle sampling enforces metric/straight budgets while retaining locked endpoints", () => {
  const shared = Array.from({ length: 21 }, (_, index) => [0, index * 0.001]);
  const first = {
    type: "Feature",
    properties: { DGUID: "left" },
    geometry: { type: "Polygon", coordinates: [[[-1, 0], ...shared, [-1, 0]]] },
  };
  const second = {
    type: "Feature",
    properties: { DGUID: "right" },
    geometry: { type: "Polygon", coordinates: [[...shared.toReversed(), [1, 0.02], [1, 0], shared.at(-1)]] },
  };
  const boundary = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: shared } }],
  };
  const handles = buildSharedBoundaryHandles([first, second], boundary);
  assert.ok(handles.length <= Math.ceil(2.3) + 1);
  assert.equal(handles[0].locked, true);
  assert.equal(handles.at(-1).locked, true);
  assert.deepEqual(handles.map((handle) => handle.id), [...handles].map((handle) => handle.id));
  handles.slice(1).forEach((handle, index) => {
    if (!handle.required) {
      assert.ok(distanceMeters(handles[index].coordinate, handle.coordinate) >= 500);
    }
  });

  const screenFiltered = filterHandlesForViewport(handles, ([, lat]) => ({ x: 0, y: lat * 1000 }));
  assert.ok(screenFiltered.length <= handles.length);
  assert.equal(screenFiltered[0].id, handles[0].id);
  assert.equal(screenFiltered.at(-1).id, handles.at(-1).id);
});

test("handle sampling supports holes and MultiPolygon/MultiLineString without mutating canonical geometry", () => {
  const shared = [[1, 0], [1, 0.5], [1, 1]];
  const first = {
    type: "Feature",
    properties: { DGUID: "left" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[
        [0, 0], ...shared, [0, 1], [0, 0],
      ], [
        [0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.3], [0.2, 0.2],
      ]]],
    },
  };
  const second = {
    type: "Feature",
    properties: { DGUID: "right" },
    geometry: { type: "Polygon", coordinates: [[...shared.toReversed(), [2, 1], [2, 0], [1, 0]]] },
  };
  const boundary = {
    type: "FeatureCollection",
    features: [{
      type: "Feature", properties: {},
      geometry: { type: "MultiLineString", coordinates: [shared.slice(0, 2), shared.slice(1)] },
    }],
  };
  const before = JSON.stringify([first, second]);
  const firstPass = buildSharedBoundaryHandles([first, second], boundary);
  const secondPass = buildSharedBoundaryHandles([first, second], boundary);
  assert.ok(firstPass.length >= 2);
  assert.deepEqual(firstPass.map((handle) => handle.id), secondPass.map((handle) => handle.id));
  assert.equal(firstPass.some((handle) => handle.occurrences.some((entry) => entry.polygonIndex === 0)), true);
  assert.equal(JSON.stringify([first, second]), before);
});

test("worker preview is non-committing and commit/undo/redo use compact operations", () => {
  const cache = createPair();
  const handle = cache.handles.find((entry) => !entry.locked);
  assert.ok(handle);
  const coordinate = [handle.coordinate[0] - 0.05, handle.coordinate[1]];
  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 1, cache });
  const preview = processCounterProposalWorkerMessage(state, {
    type: "PREVIEW_MOVE", sequence: 2, handleId: handle.id, coordinate,
  });
  assert.equal(preview.type, "PREVIEW_RESULT");
  assert.equal(state.cache.history.length, 0);
  const committed = processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE", sequence: 3, handleId: handle.id, coordinate,
  });
  assert.equal(committed.cache.history.length, 1);
  assert.equal(committed.cache.history[0].type, "move-handle");
  assert.equal(Object.hasOwn(committed.cache.history[0], "features"), false);
  const undone = processCounterProposalWorkerMessage(state, { type: "UNDO", sequence: 4 });
  assert.equal(undone.cache.history.length, 0);
  assert.equal(undone.cache.future.length, 1);
  const redone = processCounterProposalWorkerMessage(state, { type: "REDO", sequence: 5 });
  assert.equal(redone.cache.history.length, 1);
  assert.equal(redone.cache.future.length, 0);
});

test("worker ignores stale requests and reports unsupported messages without changing committed state", () => {
  const cache = createPair();
  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 10, cache });
  const stale = processCounterProposalWorkerMessage(state, {
    type: "PREVIEW_MOVE", sequence: 9, handleId: cache.handles[0].id, coordinate: [0, 0],
  });
  assert.equal(stale.type, "STALE");
  assert.strictEqual(state.cache, cache);
  const unsupported = processCounterProposalWorkerMessage(state, { type: "UNKNOWN", sequence: 11 });
  assert.equal(unsupported.type, "ERROR");
  assert.strictEqual(state.cache, cache);
});

test("worker client rejects pending and future requests after a crash", async () => {
  class FakeWorker {
    static instance;
    constructor() { FakeWorker.instance = this; this.listeners = new Map(); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage() {}
    terminate() {}
    emit(type, payload) { this.listeners.get(type)?.(payload); }
  }
  const client = createCounterProposalWorkerClient({ WorkerClass: FakeWorker });
  const pending = client.init({ id: "cache" });
  FakeWorker.instance.emit("error", { message: "worker boom" });
  await assert.rejects(pending, /worker boom/);
  await assert.rejects(client.preview("handle", [0, 0]), /worker boom/);
});

test("worker client rejects stale and unexpected response types", async () => {
  class FakeWorker {
    static instance;
    constructor() { FakeWorker.instance = this; this.listeners = new Map(); this.messages = []; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage(message) { this.messages.push(message); }
    terminate() {}
    respond(payload) { this.listeners.get("message")?.({ data: payload }); }
  }

  const client = createCounterProposalWorkerClient({ WorkerClass: FakeWorker });
  const stalePreview = client.preview("handle", [0, 0]);
  const previewMessage = FakeWorker.instance.messages.at(-1);
  FakeWorker.instance.respond({ type: "STALE", sequence: previewMessage.sequence });
  await assert.rejects(stalePreview, /stale request/);

  const unexpectedCommit = client.commit("handle", [0, 0]);
  const commitMessage = FakeWorker.instance.messages.at(-1);
  FakeWorker.instance.respond({ type: "PREVIEW_RESULT", sequence: commitMessage.sequence });
  await assert.rejects(unexpectedCommit, /Unexpected Counter-Proposal worker response/);
  client.terminate();
});

test("submission failure retains the draft and success clears it once", async () => {
  let clearCount = 0;
  let successCount = 0;
  const clearDraft = () => { clearCount += 1; };
  const onSuccess = () => { successCount += 1; };

  await assert.rejects(
    submitCounterProposalWithDraft({
      submit: async () => { throw new Error("network unavailable"); },
      payload: { id: "draft" },
      clearDraft,
      onSuccess,
    }),
    /network unavailable/,
  );
  assert.equal(clearCount, 0);
  assert.equal(successCount, 0);

  const result = await submitCounterProposalWithDraft({
    submit: async (payload) => ({ accepted: payload.id }),
    payload: { id: "draft" },
    clearDraft,
    onSuccess,
  });
  assert.deepEqual(result, { accepted: "draft" });
  assert.equal(clearCount, 1);
  assert.equal(successCount, 1);
});

test("draft storage contains operations only and rejects a changed baseline", () => {
  const values = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  try {
    const cache = createPair();
    const handle = cache.handles.find((entry) => !entry.locked);
    const workerState = createCounterProposalWorkerState();
    processCounterProposalWorkerMessage(workerState, { type: "INIT", sequence: 1, cache });
    const result = processCounterProposalWorkerMessage(workerState, {
      type: "COMMIT_MOVE",
      sequence: 2,
      handleId: handle.id,
      coordinate: [handle.coordinate[0] - 0.05, handle.coordinate[1]],
    });
    writeCounterProposalStorage({
      step: 3,
      firstDguid: "first",
      secondDguid: "second",
      previewMode: "proposal",
      cache: result.cache,
    });
    const activeKey = values.get("counter-proposal-active-draft");
    assert.match(activeKey, /^counter-proposal-draft:first:second:fnv1a-/);
    const raw = values.get(activeKey);
    assert.equal(raw.includes("currentFeatures"), false);
    assert.equal(raw.includes('"geometry"'), false);
    const draft = readCounterProposalStorage();
    const restored = restoreCounterProposalCacheFromDraft(createPair(), draft);
    assert.equal(restored.history.length, 1);
    const changed = { ...createPair(), baselineFingerprint: "different" };
    assert.strictEqual(restoreCounterProposalCacheFromDraft(changed, draft), changed);
  } finally {
    globalThis.window = originalWindow;
  }
});
