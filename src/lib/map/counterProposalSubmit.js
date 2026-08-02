import { clearCounterProposalStorage } from "./counterProposalWorkflow.js";

export async function submitCounterProposalWithDraft({
  submit,
  payload,
  onSuccess,
  clearDraft = clearCounterProposalStorage,
}) {
  const result = await submit(payload);
  clearDraft();
  onSuccess?.(result);
  return result;
}
