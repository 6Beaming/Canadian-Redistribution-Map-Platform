import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

const ACTIVATION_NOTE =
  "This page shoule be activated when the commissioner select a specific user submission on the map.";

export default function CommissionerEvaluateReport() {
  return (
    <FeaturePlaceholder title="Evaluate this Report" note={ACTIVATION_NOTE} />
  );
}
