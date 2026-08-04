import crypto from "node:crypto";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { validateRealtimeEvent } from "./eventContract.js";
import { resolveRealtimeInvalidations } from "./invalidationRegistry.js";

const OUTBOX_ENTITY_ALIASES = Object.freeze({
  "workspace.archive_request": "workspace.archive-request",
});

export function normalizeRealtimeOutboxDelivery(row, delivery) {
  const hints = row.projection_hints ?? {};
  const eventIdentity = {
    aggregateId: String(row.aggregate_id),
    entity: hints.entity
      ?? OUTBOX_ENTITY_ALIASES[row.aggregate_type]
      ?? row.aggregate_type,
    entityId: String(hints.entityId ?? row.aggregate_id),
    operation: row.operation,
    submissionId: hints.submissionId ? String(hints.submissionId) : undefined,
  };
  return validateRealtimeEvent({
    aggregateId: eventIdentity.aggregateId,
    committedAt: row.committed_at,
    entity: eventIdentity.entity,
    entityId: eventIdentity.entityId,
    eventId: row.id,
    invalidate: resolveRealtimeInvalidations(eventIdentity),
    operation: eventIdentity.operation,
    resourceVersion: row.resource_version,
    schemaVersion: 1,
    scope: hints.scope ?? {
      kind: "operating-province",
      pruids: [String(delivery.pruid)],
    },
    sequence: Number(delivery.scope_sequence),
  });
}

export class SupabaseRealtimeEventStore {
  constructor({ clientFactory = getSupabaseAdminDataClient } = {}) {
    this.clientFactory = clientFactory;
  }

  async readDispatchBatch({ afterCommittedAt = null, limit = 100 } = {}) {
    let query = this.clientFactory()
      .from("realtime_outbox")
      .select([
        "id",
        "aggregate_type",
        "aggregate_id",
        "operation",
        "resource_version",
        "projection_hints",
        "committed_at",
        "realtime_scope_deliveries!inner(outbox_id,pruid,scope_sequence,dispatched_at)",
      ].join(","))
      .order("committed_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);

    if (afterCommittedAt?.committedAt && afterCommittedAt?.outboxId) {
      query = query.or([
        `committed_at.gt.${afterCommittedAt.committedAt}`,
        `and(committed_at.eq.${afterCommittedAt.committedAt},id.gt.${afterCommittedAt.outboxId})`,
      ].join(","));
    }
    const { data, error } = await query;
    if (error) throw error;

    const deliveries = [];
    for (const row of data ?? []) {
      for (const delivery of row.realtime_scope_deliveries ?? []) {
        deliveries.push({
          event: normalizeRealtimeOutboxDelivery(row, delivery),
          outboxId: row.id,
          pruid: String(delivery.pruid),
        });
      }
    }

    return {
      deliveries,
      nextCursor: data?.length ? {
        committedAt: data.at(-1).committed_at,
        outboxId: data.at(-1).id,
      } : afterCommittedAt,
    };
  }

  async markDispatched({ outboxId, pruid, dispatchedAt = new Date().toISOString() }) {
    const { error } = await this.clientFactory()
      .from("realtime_scope_deliveries")
      .update({ dispatched_at: dispatchedAt })
      .eq("outbox_id", outboxId)
      .eq("pruid", pruid)
      .is("dispatched_at", null);
    if (error) throw error;
  }

  async replay({ pruid, afterSequence, limit = 500 }) {
    const client = this.clientFactory();
    const [firstWindow, lastWindow] = await Promise.all([
      client
        .from("realtime_scope_deliveries")
        .select("scope_sequence")
        .eq("pruid", pruid)
        .order("scope_sequence", { ascending: true })
        .limit(1),
      client
        .from("realtime_scope_deliveries")
        .select("scope_sequence")
        .eq("pruid", pruid)
        .order("scope_sequence", { ascending: false })
        .limit(1),
    ]);
    if (firstWindow.error) throw firstWindow.error;
    if (lastWindow.error) throw lastWindow.error;

    const firstRetainedSequence = Number(firstWindow.data?.[0]?.scope_sequence ?? 0);
    const latestRetainedSequence = Number(lastWindow.data?.[0]?.scope_sequence ?? afterSequence);
    if (firstRetainedSequence && afterSequence < firstRetainedSequence - 1) {
      return { events: [], latestSequence: latestRetainedSequence, resyncRequired: true };
    }

    const { data, error } = await client
      .from("realtime_scope_deliveries")
      .select([
        "outbox_id",
        "pruid",
        "scope_sequence",
        "realtime_outbox!inner(id,aggregate_type,aggregate_id,operation,resource_version,projection_hints,committed_at)",
      ].join(","))
      .eq("pruid", pruid)
      .gt("scope_sequence", afterSequence)
      .order("scope_sequence", { ascending: true })
      .limit(limit + 1);
    if (error) throw error;

    if ((data ?? []).length > limit) {
      return {
        events: [],
        latestSequence: latestRetainedSequence,
        resyncRequired: true,
      };
    }

    const events = (data ?? []).map((delivery) => normalizeRealtimeOutboxDelivery(
      delivery.realtime_outbox,
      delivery,
    ));
    return {
      events,
      latestSequence: events.at(-1)?.sequence ?? afterSequence,
      resyncRequired: false,
    };
  }
}

export class SyntheticRealtimeEventStore {
  constructor({ retentionLimit = 1000 } = {}) {
    this.deliveryOrdinal = 0;
    this.deliveries = [];
    this.dispatched = new Map();
    this.resources = new Map();
    this.retentionLimit = retentionLimit;
    this.sequences = new Map();
  }

  readResource(pruid) {
    return this.resources.get(String(pruid)) ?? {
      updatedAt: null,
      value: 0,
      version: 0,
    };
  }

  commitSyntheticMutation({ pruid, commit = true, count = 1 }) {
    const scopePruid = String(pruid);
    if (!commit) {
      return { committed: false, events: [], resource: this.readResource(scopePruid) };
    }

    const events = [];
    let resource = this.readResource(scopePruid);
    for (let index = 0; index < count; index += 1) {
      const committedAt = new Date(Date.now() + index).toISOString();
      const sequence = (this.sequences.get(scopePruid) ?? 0) + 1;
      this.sequences.set(scopePruid, sequence);
      resource = {
        updatedAt: committedAt,
        value: resource.value + 1,
        version: resource.version + 1,
      };
      this.resources.set(scopePruid, resource);
      const event = validateRealtimeEvent({
        aggregateId: `synthetic-${scopePruid}`,
        committedAt,
        entity: "synthetic.resource",
        entityId: `synthetic-${scopePruid}`,
        eventId: crypto.randomUUID(),
        invalidate: ["realtime:harness"],
        operation: resource.version === 1 ? "create" : "update",
        resourceVersion: resource.version,
        schemaVersion: 1,
        scope: { kind: "operating-province", pruids: [scopePruid] },
        sequence,
      });
      this.deliveryOrdinal += 1;
      this.deliveries.push({
        event,
        ordinal: this.deliveryOrdinal,
        outboxId: event.eventId,
        pruid: scopePruid,
      });
      events.push(event);
    }

    while (this.deliveries.length > this.retentionLimit) this.deliveries.shift();
    return { committed: true, events, resource };
  }

  commitContractEvent({
    aggregateId,
    commit = true,
    entity,
    entityId,
    operation,
    pruid,
    resourceVersion,
  }) {
    const scopePruid = String(pruid);
    if (!commit) return { committed: false, events: [] };

    const sequence = (this.sequences.get(scopePruid) ?? 0) + 1;
    this.sequences.set(scopePruid, sequence);
    const eventIdentity = {
      aggregateId: String(aggregateId),
      entity,
      entityId: String(entityId),
      operation,
    };
    const event = validateRealtimeEvent({
      ...eventIdentity,
      committedAt: new Date().toISOString(),
      eventId: crypto.randomUUID(),
      invalidate: resolveRealtimeInvalidations(eventIdentity),
      resourceVersion,
      schemaVersion: 1,
      scope: { kind: "operating-province", pruids: [scopePruid] },
      sequence,
    });
    this.deliveryOrdinal += 1;
    this.deliveries.push({
      event,
      ordinal: this.deliveryOrdinal,
      outboxId: event.eventId,
      pruid: scopePruid,
    });
    while (this.deliveries.length > this.retentionLimit) this.deliveries.shift();
    return { committed: true, events: [event] };
  }

  async readDispatchBatch({ afterCommittedAt = 0, limit = 100 } = {}) {
    const cursor = Number(afterCommittedAt) || 0;
    const deliveries = this.deliveries
      .filter((delivery) => delivery.ordinal > cursor)
      .slice(0, limit);
    return {
      deliveries,
      nextCursor: deliveries.at(-1)?.ordinal ?? cursor,
    };
  }

  async markDispatched({ outboxId, pruid, dispatchedAt = new Date().toISOString() }) {
    this.dispatched.set(`${outboxId}:${pruid}`, dispatchedAt);
  }

  async replay({ pruid, afterSequence, limit = 500 }) {
    const retained = this.deliveries.filter((delivery) => delivery.pruid === String(pruid));
    const firstSequence = retained[0]?.event.sequence ?? 0;
    const latestSequence = this.sequences.get(String(pruid)) ?? afterSequence;
    if (firstSequence && afterSequence < firstSequence - 1) {
      return { events: [], latestSequence, resyncRequired: true };
    }
    const events = retained
      .filter((delivery) => delivery.event.sequence > afterSequence)
      .map((delivery) => delivery.event);
    if (events.length > limit) {
      return { events: [], latestSequence, resyncRequired: true };
    }
    return { events, latestSequence, resyncRequired: false };
  }
}

let defaultEventStore = null;
const REALTIME_EVENT_STORE = "supabase";

export function syntheticRealtimeEnabled() {
  return REALTIME_EVENT_STORE === "synthetic";
}

export function getDefaultRealtimeEventStore() {
  if (!defaultEventStore) {
    defaultEventStore = syntheticRealtimeEnabled()
      ? new SyntheticRealtimeEventStore()
      : new SupabaseRealtimeEventStore();
  }
  return defaultEventStore;
}
