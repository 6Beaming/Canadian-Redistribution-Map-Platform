import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_LOG_PATH = path.resolve(
  process.cwd(),
  "local",
  "node-diagnostics",
  "api-process.jsonl",
);

const SIGNAL_EXIT_CODES = Object.freeze({
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
  SIGBREAK: 149,
});

const state = {
  installed: false,
  logPath: null,
  runtimeId: null,
  receivedSignal: null,
};

function serializeError(error) {
  if (!error) return null;

  return {
    name: error.name ?? "Error",
    message: error.message ?? String(error),
    code: error.code ?? null,
    errno: error.errno ?? null,
    syscall: error.syscall ?? null,
    address: error.address ?? null,
    port: error.port ?? null,
    stack: error.stack ?? null,
  };
}

function getRuntimeSnapshot() {
  let resourceUsage = null;
  try {
    resourceUsage = process.resourceUsage();
  } catch {
    // Resource usage is diagnostic-only and must never affect the API process.
  }

  return {
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    memoryUsage: process.memoryUsage(),
    resourceUsage,
  };
}

function writeFallback(message) {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // A detached or already-closed stderr must not mask the original failure.
  }
}

export function recordProcessDiagnostic(event, details = {}) {
  if (!state.installed || !state.logPath) return;

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    runtimeId: state.runtimeId,
    pid: process.pid,
    ppid: process.ppid,
    ...getRuntimeSnapshot(),
    ...details,
  };

  try {
    fs.mkdirSync(path.dirname(state.logPath), { recursive: true });
    fs.appendFileSync(state.logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    writeFallback(
      `[api-process-diagnostics] Unable to append ${event}: ${error.message}`,
    );
  }
}

export function installProcessDiagnostics({ logPath } = {}) {
  if (state.installed) {
    return {
      logPath: state.logPath,
      runtimeId: state.runtimeId,
    };
  }

  state.installed = true;
  state.logPath = path.resolve(
    logPath ?? process.env.API_PROCESS_LOG_PATH ?? DEFAULT_LOG_PATH,
  );
  state.runtimeId = randomUUID();

  recordProcessDiagnostic("process.start", {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    cwd: process.cwd(),
    argv: process.argv.slice(1),
    execArgv: process.execArgv,
  });

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    recordProcessDiagnostic("process.uncaught_exception", {
      origin,
      error: serializeError(error),
    });
  });

  process.on("beforeExit", (code) => {
    recordProcessDiagnostic("process.before_exit", {
      exitCode: code,
      processExitCode: process.exitCode ?? null,
    });
  });

  process.on("exit", (code) => {
    recordProcessDiagnostic("process.exit", {
      exitCode: code,
      processExitCode: process.exitCode ?? null,
      signal: state.receivedSignal,
    });
  });

  for (const [signal, exitCode] of Object.entries(SIGNAL_EXIT_CODES)) {
    try {
      process.once(signal, () => {
        state.receivedSignal = signal;
        recordProcessDiagnostic("process.signal", { signal, exitCode });
        process.exit(exitCode);
      });
    } catch (error) {
      recordProcessDiagnostic("process.signal_handler_unavailable", {
        signal,
        error: serializeError(error),
      });
    }
  }

  return {
    logPath: state.logPath,
    runtimeId: state.runtimeId,
  };
}

export function serializeProcessError(error) {
  return serializeError(error);
}
