import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const diagnosticsModuleUrl = pathToFileURL(
  path.resolve("server/lib/processDiagnostics.js"),
).href;

function runDiagnosticChild(logPath, body) {
  const script = `
    import { installProcessDiagnostics } from ${JSON.stringify(diagnosticsModuleUrl)};
    installProcessDiagnostics();
    ${body}
  `;

  return spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      API_PROCESS_LOG_PATH: logPath,
    },
  });
}

function readEvents(logPath) {
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("API process diagnostics", () => {
  let temporaryDirectory;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "crmp-process-diagnostics-"),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("persists the explicit child exit code", () => {
    const logPath = path.join(temporaryDirectory, "explicit-exit.jsonl");
    const result = runDiagnosticChild(logPath, "process.exit(7);");
    const events = readEvents(logPath);

    expect(result.status).toBe(7);
    expect(events.map(({ event }) => event)).toEqual([
      "process.start",
      "process.exit",
    ]);
    expect(events[1]).toMatchObject({
      exitCode: 7,
      processExitCode: 7,
      signal: null,
    });
    expect(events[0].runtimeId).toBe(events[1].runtimeId);
  });

  test("persists an uncaught exception before the child exits", () => {
    const logPath = path.join(temporaryDirectory, "uncaught.jsonl");
    const result = runDiagnosticChild(
      logPath,
      "setImmediate(() => { throw new Error('diagnostic-test-uncaught'); });",
    );
    const events = readEvents(logPath);

    expect(result.status).toBe(1);
    expect(events.map(({ event }) => event)).toEqual([
      "process.start",
      "process.uncaught_exception",
      "process.exit",
    ]);
    expect(events[1]).toMatchObject({
      origin: "uncaughtException",
      error: {
        name: "Error",
        message: "diagnostic-test-uncaught",
      },
    });
    expect(events[2]).toMatchObject({ exitCode: 1, signal: null });
  });
});
