const ENVELOPE_KEYS = Object.freeze([
  "aggregateId",
  "committedAt",
  "entity",
  "entityId",
  "eventId",
  "invalidate",
  "operation",
  "resourceVersion",
  "schemaVersion",
  "scope",
  "sequence",
]);

const SCOPE_KEYS = Object.freeze(["kind", "pruids"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_IDENTIFIER_PATTERN = /^[\p{L}\p{N}._:@/-]{1,200}$/u;
const INVALIDATION_PATTERN = /^(?:commissioner-table|realtime|workspace):[\p{L}\p{N}._:@/-]{1,220}$/u;

export const REALTIME_SCHEMA_VERSION = 1;

export const REGISTERED_REALTIME_ENTITIES = Object.freeze(new Set([
  "submission",
  "synthetic.resource",
  "workspace.archive-request",
  "workspace.comment",
  "workspace.custom-label",
  "workspace.label",
  "workspace.status",
]));

export class RealtimeEventContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "RealtimeEventContractError";
  }
}

function fail(message) {
  throw new RealtimeEventContractError(message);
}

function assertExactKeys(value, allowedKeys, label) {
  const keys = Object.keys(value).sort();
  const allowed = [...allowedKeys].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    fail(`${label} contains missing or unapproved fields.`);
  }
}

function requireSafeIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value)) {
    fail(`${label} must be a non-empty safe identifier.`);
  }
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an ISO-8601 timestamp.`);
  }
}

export function validateRealtimeEvent(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("Realtime event must be an object.");
  }

  assertExactKeys(candidate, ENVELOPE_KEYS, "Realtime event");

  if (candidate.schemaVersion !== REALTIME_SCHEMA_VERSION) {
    fail(`Unsupported realtime schema version: ${candidate.schemaVersion}.`);
  }

  if (typeof candidate.eventId !== "string" || !UUID_PATTERN.test(candidate.eventId)) {
    fail("eventId must be a UUID.");
  }

  if (!Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1) {
    fail("sequence must be a positive safe integer.");
  }

  const entities = options.entities ?? REGISTERED_REALTIME_ENTITIES;
  if (!entities.has(candidate.entity)) {
    fail(`Unregistered realtime entity: ${candidate.entity}.`);
  }

  if (!["create", "update", "delete"].includes(candidate.operation)) {
    fail("operation must be create, update, or delete.");
  }

  requireSafeIdentifier(candidate.entityId, "entityId");
  requireSafeIdentifier(candidate.aggregateId, "aggregateId");

  if (
    !["string", "number"].includes(typeof candidate.resourceVersion)
    || String(candidate.resourceVersion).trim().length === 0
    || String(candidate.resourceVersion).length > 128
  ) {
    fail("resourceVersion must be a bounded timestamp or version value.");
  }

  if (!candidate.scope || typeof candidate.scope !== "object" || Array.isArray(candidate.scope)) {
    fail("scope must be an object.");
  }
  assertExactKeys(candidate.scope, SCOPE_KEYS, "Realtime scope");
  if (!["operating-province", "province", "user"].includes(candidate.scope.kind)) {
    fail("scope kind is not registered.");
  }
  if (
    !Array.isArray(candidate.scope.pruids)
    || candidate.scope.pruids.length > 2
    || candidate.scope.pruids.some((pruid) => !/^\d{2}$/u.test(String(pruid)))
  ) {
    fail("scope.pruids must contain at most two canonical PRUIDs.");
  }
  if (candidate.scope.kind !== "user" && candidate.scope.pruids.length !== 1) {
    fail("A live province event must name exactly one operating PRUID.");
  }

  if (
    !Array.isArray(candidate.invalidate)
    || candidate.invalidate.length < 1
    || candidate.invalidate.length > 16
    || candidate.invalidate.some((key) => typeof key !== "string" || !INVALIDATION_PATTERN.test(key))
  ) {
    fail("invalidate must contain only registered, bounded invalidation hints.");
  }

  requireIsoTimestamp(candidate.committedAt, "committedAt");

  return Object.freeze({
    ...candidate,
    invalidate: Object.freeze([...candidate.invalidate]),
    scope: Object.freeze({
      kind: candidate.scope.kind,
      pruids: Object.freeze(candidate.scope.pruids.map(String)),
    }),
  });
}

function numericVersion(value) {
  const normalized = String(value);
  return /^\d+$/u.test(normalized) ? BigInt(normalized) : null;
}

export function compareResourceVersions(left, right) {
  const leftNumeric = numericVersion(left);
  const rightNumeric = numericVersion(right);
  if (leftNumeric !== null && rightNumeric !== null) {
    return leftNumeric === rightNumeric ? 0 : leftNumeric > rightNumeric ? 1 : -1;
  }

  const leftTime = Date.parse(String(left));
  const rightTime = Date.parse(String(right));
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return Math.sign(leftTime - rightTime);
  }

  return String(left).localeCompare(String(right));
}

