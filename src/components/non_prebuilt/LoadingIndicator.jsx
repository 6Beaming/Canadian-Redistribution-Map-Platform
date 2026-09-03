export function LoadingIndicator({ label = "Loading...", className = "" }) {
  return (
    <div
      className={`route-loading-overlay__indicator ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="route-loading-overlay__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function PanelLoadingOverlay({ label = "Loading..." }) {
  return (
    <div className="route-loading-overlay--panel" aria-busy="true" aria-label="Loading">
      <LoadingIndicator label={label} />
    </div>
  );
}
