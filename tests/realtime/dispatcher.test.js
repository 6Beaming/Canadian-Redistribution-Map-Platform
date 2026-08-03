import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "@jest/globals";
import { RealtimeDispatcher } from "../../server/realtime/dispatcher.js";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";

function quietLogger() {
  return { error() {} };
}

const execFileAsync = promisify(execFile);

test("dispatcher hands committed deliveries to transport before marking them dispatched", async () => {
  const store = new SyntheticRealtimeEventStore();
  const committed = store.commitSyntheticMutation({ pruid: "46", count: 1 });
  const calls = [];
  const originalMark = store.markDispatched.bind(store);
  store.markDispatched = async (delivery) => {
    calls.push(`mark:${delivery.outboxId}`);
    await originalMark(delivery);
  };
  const dispatcher = new RealtimeDispatcher({
    eventStore: store,
    logger: quietLogger(),
    publisher: async ({ event }) => { calls.push(`publish:${event.eventId}`); },
  });
  await dispatcher.dispatchOnce();
  assert.deepEqual(calls, [
    `publish:${committed.events[0].eventId}`,
    `mark:${committed.events[0].eventId}`,
  ]);
});

test("rolled-back synthetic writes emit no delivery", async () => {
  const store = new SyntheticRealtimeEventStore();
  store.commitSyntheticMutation({ pruid: "46", commit: false });
  const delivered = [];
  const dispatcher = new RealtimeDispatcher({
    eventStore: store,
    logger: quietLogger(),
    publisher: async (delivery) => delivered.push(delivery),
  });
  assert.equal(await dispatcher.dispatchOnce(), 0);
  assert.deepEqual(delivered, []);
});

test("two independent dispatcher instances observe the same durable contract rows", async () => {
  const store = new SyntheticRealtimeEventStore();
  store.commitSyntheticMutation({ pruid: "46", count: 2 });
  const firstInstance = [];
  const secondInstance = [];
  const dispatcherA = new RealtimeDispatcher({
    consumerId: "server-process-a",
    eventStore: store,
    logger: quietLogger(),
    publisher: async ({ event }) => firstInstance.push(event.eventId),
  });
  const dispatcherB = new RealtimeDispatcher({
    consumerId: "server-process-b",
    eventStore: store,
    logger: quietLogger(),
    publisher: async ({ event }) => secondInstance.push(event.eventId),
  });
  await dispatcherA.dispatchOnce();
  await dispatcherB.dispatchOnce();
  assert.equal(firstInstance.length, 2);
  assert.deepEqual(secondInstance, firstInstance);
});

test("a separate Node server process can consume the same durable delivery fixture", async () => {
  const store = new SyntheticRealtimeEventStore();
  const committed = store.commitSyntheticMutation({ pruid: "46", count: 1 });
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "crmp-realtime-"));
  const fixturePath = path.join(tempDirectory, "deliveries.json");
  try {
    await fs.writeFile(fixturePath, JSON.stringify({
      deliveries: store.deliveries,
      nextCursor: store.deliveryOrdinal,
    }));
    const childPath = path.resolve("tests/realtime/fixtures/fileStoreChild.js");
    const { stdout } = await execFileAsync(process.execPath, [childPath, fixturePath], {
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    assert.deepEqual(JSON.parse(stdout), [committed.events[0].eventId]);
  } finally {
    await fs.rm(tempDirectory, { force: true, recursive: true });
  }
});

test("replay returns ordered retained events or resync-required after retention expiry", async () => {
  const store = new SyntheticRealtimeEventStore({ retentionLimit: 2 });
  store.commitSyntheticMutation({ pruid: "46", count: 2 });
  const dispatcher = new RealtimeDispatcher({
    eventStore: store,
    logger: quietLogger(),
    publisher: async () => {},
  });
  const replay = await dispatcher.replay("46", 0);
  assert.deepEqual(replay.events.map((event) => event.sequence), [1, 2]);

  store.commitSyntheticMutation({ pruid: "46", count: 1 });
  const expired = await dispatcher.replay("46", 0);
  assert.equal(expired.resyncRequired, true);
  assert.equal(expired.latestSequence, 3);
});

test("dispatcher rejects a delivery whose operating PRUID does not match its event", async () => {
  const store = new SyntheticRealtimeEventStore();
  store.commitSyntheticMutation({ pruid: "46" });
  store.deliveries[0] = { ...store.deliveries[0], pruid: "47" };
  const delivered = [];
  const dispatcher = new RealtimeDispatcher({
    eventStore: store,
    logger: quietLogger(),
    publisher: async (delivery) => delivered.push(delivery),
  });
  await dispatcher.dispatchOnce();
  assert.deepEqual(delivered, []);
});
