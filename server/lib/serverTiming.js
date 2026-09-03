const HIGH_RESOLUTION = typeof performance !== "undefined" && typeof performance.now === "function";

function now() {
  return HIGH_RESOLUTION ? performance.now() : Date.now();
}

export function createServerTiming() {
  const spans = [];

  return {
    start(name) {
      const startedAt = now();
      return {
        end(extra = {}) {
          const duration = Math.max(0, now() - startedAt);
          spans.push({ name, duration, ...extra });
          return duration;
        },
      };
    },
    measure(name, durationMs) {
      spans.push({ name, duration: Math.max(0, durationMs) });
    },
    headerValue() {
      return spans
        .map((span) => `${span.name};dur=${span.duration.toFixed(1)}`)
        .join(", ");
    },
    spans() {
      return spans.map((span) => ({ ...span }));
    },
  };
}

export function serverTimingMiddleware(req, res, next) {
  const timing = createServerTiming();
  req.serverTiming = timing;
  const requestSpan = timing.start("total");

  function attachHeaderIfNeeded() {
    if (res.headersSent) return;
    const header = timing.headerValue();
    if (header && !res.getHeader("Server-Timing")) {
      res.setHeader("Server-Timing", header);
    }
  }

  const originalWrite = res.write;
  res.write = function writeWithTiming(chunk, ...args) {
    attachHeaderIfNeeded();
    return originalWrite.call(this, chunk, ...args);
  };

  const originalEnd = res.end;
  res.end = function endWithTiming(...args) {
    requestSpan.end();
    attachHeaderIfNeeded();
    return originalEnd.apply(this, args);
  };

  next();
}

export async function withServerTimingSpan(req, name, task) {
  const span = req.serverTiming?.start(name);
  try {
    return await task();
  } finally {
    span?.end();
  }
}
