const INVALIDATION_RESOLVERS = Object.freeze({
  submission: ({ aggregateId }) => [
    `workspace:submission:${aggregateId}`,
    `workspace:branch:${aggregateId}`,
    `commissioner-table:submission:${aggregateId}`,
  ],
  "synthetic.resource": () => ["realtime:harness"],
  "workspace.comment": ({ aggregateId }) => [
    `workspace:comments:${aggregateId}`,
    `workspace:branch:${aggregateId}`,
  ],
  "workspace.custom-label": ({ aggregateId }) => [
    `workspace:custom-labels:${aggregateId}`,
  ],
  "workspace.label": ({ aggregateId }) => [
    `workspace:labels:${aggregateId}`,
    `workspace:branch:${aggregateId}`,
  ],
  "workspace.status": ({ aggregateId }) => [
    `workspace:status:${aggregateId}`,
    `workspace:submission:${aggregateId}`,
    `workspace:branch:${aggregateId}`,
    `commissioner-table:submission:${aggregateId}`,
  ],
  "workspace.archive-request": ({ aggregateId, submissionId }) => {
    const targetId = submissionId ?? aggregateId;
    return [
      `workspace:archive-request:${targetId}`,
      `workspace:status:${targetId}`,
      `workspace:submission:${targetId}`,
      `workspace:branch:${targetId}`,
      `commissioner-table:submission:${targetId}`,
    ];
  },
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
