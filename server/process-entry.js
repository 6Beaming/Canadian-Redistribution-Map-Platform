import {
  installProcessDiagnostics,
  recordProcessDiagnostic,
  serializeProcessError,
} from "./lib/processDiagnostics.js";

installProcessDiagnostics();

try {
  await import("./index.js");
} catch (error) {
  recordProcessDiagnostic("process.bootstrap_failure", {
    error: serializeProcessError(error),
  });
  throw error;
}
