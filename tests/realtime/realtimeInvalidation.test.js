import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  clearRealtimeInvalidationConsumersForTests,
  invalidateRealtimeEvent,
  resyncRealtimeQueries,
  subscribeRealtimeInvalidation,
} from "../../src/lib/realtime/realtimeInvalidation.js";

afterEach(() => clearRealtimeInvalidationConsumersForTests());

test("invalidation refetches only matching active HTTP consumers", async () => {
  const calls = [];
  subscribeRealtimeInvalidation("workspace:*", ({ resync }) => calls.push(`workspace:${resync}`));
  subscribeRealtimeInvalidation("commissioner-table:*", () => calls.push("table"));
  subscribeRealtimeInvalidation("realtime:harness", () => calls.push("harness"));
  await invalidateRealtimeEvent({ invalidate: ["workspace:list", "realtime:harness"] });
  assert.deepEqual(calls.sort(), ["harness", "workspace:false"]);
});

test("resync-required refetches every active scoped query", async () => {
  const calls = [];
  subscribeRealtimeInvalidation("workspace:*", ({ resync }) => calls.push(resync));
  subscribeRealtimeInvalidation("commissioner-table:*", ({ resync }) => calls.push(resync));
  await resyncRealtimeQueries();
  assert.deepEqual(calls, [true, true]);
});

