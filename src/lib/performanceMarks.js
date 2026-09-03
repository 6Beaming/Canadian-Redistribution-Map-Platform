const ENABLED = import.meta.env.DEV;

export function mark(name) {
  if (!ENABLED || typeof performance === "undefined" || typeof performance.mark !== "function") {
    return;
  }
  performance.mark(name);
}

export function measure(name, startMark, endMark) {
  if (!ENABLED || typeof performance.measure !== "function") {
    return;
  }
  try {
    performance.measure(name, startMark, endMark);
    const entry = performance.getEntriesByName(name).at(-1);
    if (entry) {
      console.debug(`[perf] ${name}: ${Math.round(entry.duration)}ms`);
    }
  } catch {
    // Ignore missing marks during partial navigation.
  }
}

export function clearPerformanceMarks(...names) {
  if (!ENABLED) return;
  for (const name of names) {
    performance.clearMarks?.(name);
    performance.clearMeasures?.(name);
  }
}
