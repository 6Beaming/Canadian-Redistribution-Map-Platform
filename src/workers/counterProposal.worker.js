import {
  createCounterProposalWorkerState,
  processCounterProposalWorkerMessage,
} from "../lib/map/counterProposalWorkerDomain.js";

const state = createCounterProposalWorkerState();

self.addEventListener("message", (event) => {
  try {
    self.postMessage(processCounterProposalWorkerMessage(state, event.data));
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      sequence: Number(event.data?.sequence) || 0,
      error: error?.message || "Counter-Proposal worker failed.",
    });
  }
});
