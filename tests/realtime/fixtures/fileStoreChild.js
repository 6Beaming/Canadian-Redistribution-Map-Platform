import fs from "node:fs/promises";
import { RealtimeDispatcher } from "../../../server/realtime/dispatcher.js";

const fixture = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const delivered = [];
const store = {
  async markDispatched() {},
  async readDispatchBatch() {
    return { deliveries: fixture.deliveries, nextCursor: fixture.nextCursor };
  },
  async replay() {
    return { events: [], latestSequence: 0, resyncRequired: false };
  },
};
const dispatcher = new RealtimeDispatcher({
  consumerId: "separate-node-process",
  eventStore: store,
  logger: { error() {} },
  publisher: async ({ event }) => delivered.push(event.eventId),
});
await dispatcher.dispatchOnce();
process.stdout.write(JSON.stringify(delivered));

