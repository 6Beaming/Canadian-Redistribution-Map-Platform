import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "@jest/globals";
import { RealtimeClient } from "../../src/lib/realtime/realtimeClient.js";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.listeners = new Map();
    this.readyState = 0;
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  message(value) {
    this.emit("message", { data: JSON.stringify(value) });
  }

  close(code = 1000) {
    this.readyState = 3;
    this.emit("close", { code });
  }
}

function event(sequence, resourceVersion = sequence, overrides = {}) {
  return {
    aggregateId: "synthetic-46",
    committedAt: new Date(1_800_000_000_000 + sequence).toISOString(),
    entity: "synthetic.resource",
    entityId: "synthetic-46",
    eventId: crypto.randomUUID(),
    invalidate: ["realtime:harness"],
    operation: "update",
    resourceVersion,
    schemaVersion: 1,
    scope: { kind: "operating-province", pruids: ["46"] },
    sequence,
    ...overrides,
  };
}

test("client exposes state, deduplicates, orders resource versions, and tears down", async () => {
  FakeWebSocket.instances = [];
  const states = [];
  const received = [];
  const client = new RealtimeClient({
    WebSocketImpl: FakeWebSocket,
    onEvent: async (message) => received.push(message.resourceVersion),
    onStateChange: (state) => states.push(state),
    urlFactory: (since) => `ws://example.test/api/realtime?since=${since}`,
  });
  client.start("commissioner-1:commissioner:MB");
  const socket = FakeWebSocket.instances[0];
  socket.open();
  const first = event(1, 2);
  socket.message(first);
  socket.message(first);
  socket.message(event(2, 1));
  socket.message(event(3, 3));
  await client.messageChain;
  assert.deepEqual(received, [2, 3]);
  assert.deepEqual(states, ["reconnecting", "live"]);
  client.stop();
  assert.equal(client.state, "offline");
  assert.equal(socket.readyState, 3);
});

test("client forces full resync for a sequence gap and server resync-required", async () => {
  FakeWebSocket.instances = [];
  const reasons = [];
  const client = new RealtimeClient({
    WebSocketImpl: FakeWebSocket,
    onResync: async (reason) => reasons.push(reason),
    urlFactory: () => "ws://example.test/api/realtime",
  });
  client.start("session");
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message(event(1));
  socket.message(event(3));
  socket.message({ schemaVersion: 1, type: "resync-required", reason: "retention-expired", latestSequence: 8 });
  await client.messageChain;
  assert.deepEqual(reasons, ["sequence-gap", "retention-expired"]);
  assert.equal(client.lastSequence, 8);
});

test("client reconnects with capped exponential backoff and resumes its last sequence", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const client = new RealtimeClient({
    WebSocketImpl: FakeWebSocket,
    baseDelayMs: 100,
    maxDelayMs: 200,
    random: () => 0.5,
    setTimeoutImpl: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutImpl: () => {},
    urlFactory: (since) => `ws://example.test/api/realtime?since=${since}`,
  });
  client.start("session");
  const firstSocket = FakeWebSocket.instances[0];
  firstSocket.open();
  firstSocket.message(event(1));
  await client.messageChain;
  firstSocket.close(1006);
  assert.equal(scheduled[0].delay, 100);
  scheduled[0].callback();
  assert.match(FakeWebSocket.instances[1].url, /since=1$/u);
});

test("client closes the old socket on profile-scope change and ignores its queued messages", async () => {
  FakeWebSocket.instances = [];
  const received = [];
  const client = new RealtimeClient({
    WebSocketImpl: FakeWebSocket,
    onEvent: async (message) => received.push(message.eventId),
    urlFactory: () => "ws://example.test/api/realtime",
  });
  client.start("commissioner-1:commissioner:MB");
  const oldSocket = FakeWebSocket.instances[0];
  oldSocket.open();
  client.start("commissioner-1:commissioner:SK");
  assert.equal(oldSocket.readyState, 3);
  const newSocket = FakeWebSocket.instances[1];
  newSocket.open();
  oldSocket.message(event(1));
  newSocket.message(event(1));
  await client.messageChain;
  assert.equal(received.length, 1);
});

test("failed targeted refetch falls back to full resync before acknowledging", async () => {
  FakeWebSocket.instances = [];
  const reasons = [];
  const client = new RealtimeClient({
    WebSocketImpl: FakeWebSocket,
    onEvent: async () => { throw new Error("HTTP unavailable"); },
    onResync: async (reason) => reasons.push(reason),
    urlFactory: () => "ws://example.test/api/realtime",
  });
  client.start("session");
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message(event(1));
  await client.messageChain;
  assert.deepEqual(reasons, ["invalidation-refetch-failed"]);
  assert.equal(client.lastSequence, 1);
});
