import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  getDefaultRealtimeEventStore,
  SupabaseRealtimeEventStore,
  syntheticRealtimeEnabled,
} from "../../server/realtime/eventStore.js";

test("Durable Supabase store without environment configuration", () => {
  assert.equal(syntheticRealtimeEnabled(), false);
  assert.equal(getDefaultRealtimeEventStore() instanceof SupabaseRealtimeEventStore, true);
});
