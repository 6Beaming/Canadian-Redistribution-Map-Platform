export function createEchoSuppressor({ ttlMs = 2500 } = {}) {
  const until = new Map();

  return {
    mark(keys) {
      const expiry = Date.now() + ttlMs;
      for (const key of keys) {
        until.set(String(key), expiry);
      }
    },
    isSuppressed(key) {
      const expiry = until.get(String(key));
      if (!expiry) return false;
      if (Date.now() > expiry) {
        until.delete(String(key));
        return false;
      }
      return true;
    },
    filter(hints) {
      return hints.filter((hint) => !this.isSuppressed(hint));
    },
  };
}

export function workspaceReviewHint(submissionId, target) {
  const id = String(submissionId);
  const hints = {
    comments: `workspace:comments:${id}`,
    labels: `workspace:labels:${id}`,
    labelCatalog: `workspace:custom-labels:${id}`,
    archiveRequest: `workspace:archive-request:${id}`,
    status: `workspace:status:${id}`,
  };
  return hints[target] ?? null;
}
