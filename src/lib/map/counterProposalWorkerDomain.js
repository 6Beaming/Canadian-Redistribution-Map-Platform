import {
  commitCounterProposalCacheHistory,
  previewCounterProposalHandleMove,
  redoCounterProposalCache,
  undoCounterProposalCache,
} from "./counterProposalWorkflow.js";
import {
  exportSubmissionOperations,
  initializeWorkerOperationState,
  syncWorkerOperationState,
} from "./counterProposalOperations.js";

function movedHandle(cache, handleId) {
  return cache?.handles?.find((handle) => handle.id === handleId || handle.legacyId === handleId) ?? null;
}

function coordinatesDiffer(left, right) {
  return !Array.isArray(left) || !Array.isArray(right)
    || Math.abs(Number(left[0]) - Number(right[0])) > 1e-10
    || Math.abs(Number(left[1]) - Number(right[1])) > 1e-10;
}

export function createCounterProposalWorkerState() {
  return {
    cache: null,
    latestSequence: 0,
    operationState: null,
  };
}

export function processCounterProposalWorkerMessage(state, message) {
  const sequence = Number(message?.sequence) || 0;
  if (message?.type === "INIT") {
    state.cache = message.cache ?? null;
    state.operationState = state.cache ? initializeWorkerOperationState(state.cache) : null;
    state.latestSequence = Math.max(state.latestSequence, sequence);
    return { type: "READY", sequence };
  }
  if (!state.cache) {
    return { type: "ERROR", sequence, error: "Counter-Proposal worker is not initialized." };
  }
  if (sequence && sequence < state.latestSequence) {
    return { type: "STALE", sequence };
  }
  state.latestSequence = Math.max(state.latestSequence, sequence);

  if (message.type === "PREVIEW_MOVE") {
    const preview = previewCounterProposalHandleMove(
      state.cache,
      message.handleId,
      message.coordinate,
    );
    const handle = movedHandle(preview, message.handleId);
    return {
      type: "PREVIEW_RESULT",
      sequence,
      handleId: handle?.id ?? message.handleId,
      coordinate: handle?.coordinate ?? null,
      impacts: preview?.impacts ?? null,
      valid: preview !== state.cache,
    };
  }

  if (message.type === "COMMIT_MOVE") {
    const baseline = state.cache.currentFeatures;
    const before = movedHandle(state.cache, message.handleId);
    const preview = previewCounterProposalHandleMove(
      state.cache,
      message.handleId,
      message.coordinate,
    );
    state.cache = commitCounterProposalCacheHistory(preview, baseline);
    syncWorkerOperationState(state.operationState, state.cache);
    const after = movedHandle(state.cache, message.handleId);
    const valid = Boolean(before && after && coordinatesDiffer(before.coordinate, after.coordinate));
    return {
      type: "COMMIT_RESULT",
      sequence,
      valid,
      committedCoordinate: after?.coordinate ?? before?.coordinate ?? null,
      impacts: state.cache.impacts ?? null,
      rejectionReason: valid ? null : "No valid movement was available for this handle.",
      committedPatch: valid ? {
        handleId: after?.id ?? message.handleId,
        coordinate: after?.coordinate ?? null,
        impacts: state.cache.impacts ?? null,
      } : null,
    };
  }

  if (message.type === "UNDO") {
    state.cache = undoCounterProposalCache(state.cache);
    syncWorkerOperationState(state.operationState, state.cache);
    return {
      type: "COMMIT_RESULT",
      sequence,
      action: "undo",
      impacts: state.cache?.impacts ?? null,
    };
  }

  if (message.type === "REDO") {
    state.cache = redoCounterProposalCache(state.cache);
    syncWorkerOperationState(state.operationState, state.cache);
    return {
      type: "COMMIT_RESULT",
      sequence,
      action: "redo",
      impacts: state.cache?.impacts ?? null,
    };
  }

  if (message.type === "EXPORT_SUBMISSION_OPERATIONS") {
    const payload = exportSubmissionOperations(state.operationState, state.cache);
    return {
      type: "SUBMISSION_OPERATIONS_RESULT",
      sequence,
      ...payload,
    };
  }

  return { type: "ERROR", sequence, error: `Unsupported worker message: ${message?.type ?? "unknown"}.` };
}
