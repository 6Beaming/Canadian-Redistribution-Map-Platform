import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "@/contexts/RealtimeContext.jsx";
import { subscribeRealtimeInvalidation } from "@/lib/realtime/realtimeInvalidation.js";

async function readPayload(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 409) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export default function RealtimeHarness() {
  const { connectionState, disconnect, lastEvent, reconnect } = useRealtime();
  const [resource, setResource] = useState(null);
  const [scope, setScope] = useState(null);
  const [message, setMessage] = useState("Loading authoritative synthetic resource…");
  const [refetchCount, setRefetchCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch("/api/realtime/harness/resource", { credentials: "include" });
      const payload = await readPayload(response);
      setResource(payload.resource);
      setScope(payload.scope);
      setRefetchCount((current) => current + 1);
      setMessage("Authoritative HTTP resource is current.");
    } catch (error) {
      setMessage(error.message || "Authoritative refetch failed.");
      throw error;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeRealtimeInvalidation("realtime:harness", refetch);
    void refetch();
    return unsubscribe;
  }, [refetch]);

  async function mutate({ commit, count }) {
    setBusy(true);
    setMessage(commit ? "Committing synthetic mutation…" : "Rolling back synthetic mutation…");
    try {
      const response = await fetch("/api/realtime/harness/mutations", {
        body: JSON.stringify({ commit, count }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readPayload(response);
      setResource(payload.resource);
      setMessage(payload.committed
        ? `${payload.emittedEventIds.length} durable invalidation(s) committed.`
        : "Mutation rolled back; no event was emitted.");
    } catch (error) {
      setMessage(error.message || "Synthetic mutation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Checkpoint 0</p>
        <h1 className="text-2xl font-semibold">Realtime multi-browser harness</h1>
        <p className="mt-2 text-sm text-slate-600">
          Open this page in two signed-in, same-province Commissioner browsers. Events contain
          invalidation metadata only; the value below always comes from authenticated HTTP refetch.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-xs uppercase text-slate-500">Connection</dt><dd className="font-semibold">{connectionState}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Operating PRUID</dt><dd className="font-semibold">{scope?.pruid ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Authoritative value</dt><dd className="font-semibold">{resource?.value ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Resource version</dt><dd className="font-semibold">{resource?.version ?? "—"}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">HTTP refetches</dt><dd className="font-semibold">{refetchCount}</dd></div>
          <div className="min-w-0"><dt className="text-xs uppercase text-slate-500">Last event</dt><dd className="truncate font-mono text-xs">{lastEvent?.eventId ?? "—"}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-slate-600">{message}</p>
      </section>

      <section className="flex flex-wrap gap-3" aria-label="Synthetic realtime controls">
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy} onClick={() => mutate({ commit: true, count: 1 })} type="button">Commit one</button>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy} onClick={() => mutate({ commit: true, count: 2 })} type="button">Commit two ordered</button>
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50" disabled={busy} onClick={() => mutate({ commit: false, count: 1 })} type="button">Roll back</button>
        {connectionState === "offline" ? (
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" onClick={reconnect} type="button">Reconnect</button>
        ) : (
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" onClick={disconnect} type="button">Disconnect</button>
        )}
        <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" onClick={() => void refetch()} type="button">Refetch HTTP</button>
      </section>
    </main>
  );
}

