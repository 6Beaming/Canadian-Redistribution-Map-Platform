import crypto from "node:crypto";
import { validateRealtimeEvent } from "./eventContract.js";

export class RealtimeDispatcher {
  constructor({
    eventStore,
    pollIntervalMs = 250,
    batchSize = 100,
    publisher,
    logger = console,
    consumerId = crypto.randomUUID(),
  }) {
    if (!eventStore || typeof eventStore.readDispatchBatch !== "function") {
      throw new TypeError("RealtimeDispatcher requires the frozen event-store contract.");
    }
    if (typeof publisher !== "function") {
      throw new TypeError("RealtimeDispatcher requires a transport publisher.");
    }
    this.batchSize = batchSize;
    this.consumerId = consumerId;
    this.cursor = null;
    this.eventStore = eventStore;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.publisher = publisher;
    this.running = false;
    this.timer = null;
  }

  async dispatchOnce() {
    const batch = await this.eventStore.readDispatchBatch({
      afterCommittedAt: this.cursor,
      consumerId: this.consumerId,
      limit: this.batchSize,
    });

    for (const delivery of batch.deliveries ?? []) {
      try {
        const event = validateRealtimeEvent(delivery.event);
        if (
          event.scope.kind !== "user"
          && !event.scope.pruids.includes(String(delivery.pruid))
        ) {
          throw new Error("Delivery PRUID is outside the validated event scope.");
        }
        await this.publisher({ ...delivery, event });
        await this.eventStore.markDispatched({
          outboxId: delivery.outboxId ?? event.eventId,
          pruid: String(delivery.pruid),
        });
      } catch (error) {
        this.logger.error?.("Realtime delivery rejected.", {
          error: error.message,
          outboxId: delivery.outboxId,
        });
      }
    }

    this.cursor = batch.nextCursor ?? this.cursor;
    return batch.deliveries?.length ?? 0;
  }

  async replay(pruid, afterSequence, limit = 500) {
    const result = await this.eventStore.replay({
      afterSequence,
      limit,
      pruid: String(pruid),
    });
    return {
      ...result,
      events: result.resyncRequired
        ? []
        : (result.events ?? []).map((event) => validateRealtimeEvent(event)),
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const poll = async () => {
      if (!this.running) return;
      try {
        await this.dispatchOnce();
      } catch (error) {
        this.logger.error?.("Realtime dispatcher poll failed.", error);
      } finally {
        if (this.running) this.timer = setTimeout(poll, this.pollIntervalMs);
      }
    };
    void poll();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

