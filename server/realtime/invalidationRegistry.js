const INVALIDATION_RESOLVERS = Object.freeze({
  submission: ({ aggregateId }) => [
    `workspace:submission:${aggregateId}`,
    `workspace:branch:${aggregateId}`,
  ],
  "synthetic.resource": () => ["realtime:harness"],
});

export class RealtimeInvalidationRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = "RealtimeInvalidationRegistryError";
  }
}

export function resolveRealtimeInvalidations(event) {
  const resolver = INVALIDATION_RESOLVERS[event?.entity];
  if (!resolver) {
    throw new RealtimeInvalidationRegistryError(
      `Realtime entity has no enabled Checkpoint 0 invalidation adapter: ${event?.entity ?? "unknown"}.`,
    );
  }

  return Object.freeze([...new Set(resolver(event))]);
}
