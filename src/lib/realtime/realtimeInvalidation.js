export const REALTIME_INVALIDATION_EVENT = "crmp:realtime-invalidation";

const consumers = new Set();

function matches(pattern, hint) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return hint.startsWith(pattern.slice(0, -1));
  return pattern === hint;
}

function dispatchBrowserEvent(detail) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(REALTIME_INVALIDATION_EVENT, { detail }));
}

export function subscribeRealtimeInvalidation(keys, refetch) {
  const patterns = (Array.isArray(keys) ? keys : [keys]).map(String);
  const consumer = { patterns, refetch };
  consumers.add(consumer);
  return () => consumers.delete(consumer);
}

export async function invalidateRealtimeEvent(event) {
  const hints = [...new Set(event?.invalidate ?? [])];
  hints.forEach((resource) => dispatchBrowserEvent({ event, resource }));
  const tasks = [];
  for (const consumer of consumers) {
    if (hints.some((hint) => consumer.patterns.some((pattern) => matches(pattern, hint)))) {
      tasks.push(Promise.resolve().then(() => consumer.refetch({ event, hints, resync: false })));
    }
  }
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(failures.map((failure) => failure.reason), "Realtime refetch failed.");
  }
  return results;
}

export async function resyncRealtimeQueries(reason = "resync-required") {
  dispatchBrowserEvent({ reason, resource: null, resync: true });
  const results = await Promise.allSettled(
    [...consumers].map((consumer) => Promise.resolve().then(() => consumer.refetch({
      event: null,
      hints: [],
      reason,
      resync: true,
    }))),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(failures.map((failure) => failure.reason), "Realtime resync failed.");
  }
  return results;
}

export function clearRealtimeInvalidationConsumersForTests() {
  consumers.clear();
}
