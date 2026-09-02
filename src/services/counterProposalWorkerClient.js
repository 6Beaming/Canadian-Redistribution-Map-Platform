export function createCounterProposalWorkerClient({ WorkerClass } = {}) {
  const ResolvedWorker = WorkerClass ?? (typeof Worker === "undefined" ? null : Worker);
  if (!ResolvedWorker) return null;
  const worker = new ResolvedWorker(new URL("../workers/counterProposal.worker.js", import.meta.url), {
    type: "module",
  });
  let sequence = 0;
  const pending = new Map();
  let closedError = null;

  function request(type, expectedType, payload = {}) {
    if (closedError) return Promise.reject(closedError);
    sequence += 1;
    const currentSequence = sequence;
    return new Promise((resolve, reject) => {
      pending.set(currentSequence, { expectedType, resolve, reject });
      worker.postMessage({ type, sequence: currentSequence, ...payload });
    });
  }

  worker.addEventListener("message", (event) => {
    const waiter = pending.get(Number(event.data?.sequence));
    if (!waiter) return;
    pending.delete(Number(event.data.sequence));
    if (event.data.type === "ERROR") {
      waiter.reject(new Error(event.data.error));
    } else if (event.data.type === "STALE") {
      waiter.reject(new Error("Counter-Proposal worker ignored a stale request."));
    } else if (event.data.type !== waiter.expectedType) {
      waiter.reject(new Error(
        `Unexpected Counter-Proposal worker response: ${event.data.type ?? "unknown"}.`,
      ));
    } else {
      waiter.resolve(event.data);
    }
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Counter-Proposal worker crashed.");
    closedError = error;
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
  });

  return {
    init: (cache) => request("INIT", "READY", { cache }),
    preview: (handleId, coordinate) => request(
      "PREVIEW_MOVE",
      "PREVIEW_RESULT",
      { handleId, coordinate },
    ),
    commit: (handleId, coordinate) => request(
      "COMMIT_MOVE",
      "COMMIT_RESULT",
      { handleId, coordinate },
    ),
    undo: () => request("UNDO", "COMMIT_RESULT"),
    redo: () => request("REDO", "COMMIT_RESULT"),
    exportSubmissionOperations: () => request(
      "EXPORT_SUBMISSION_OPERATIONS",
      "SUBMISSION_OPERATIONS_RESULT",
    ),
    terminate() {
      worker.terminate();
      const error = new Error("Counter-Proposal worker terminated.");
      closedError = error;
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
    },
  };
}
