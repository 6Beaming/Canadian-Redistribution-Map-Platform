export function RouteLoadingPage({ label = "Loading page…", error = "", onRetry }) {
  return (
    <main className="route-loading-page" aria-busy={!error}>
      <div className="route-loading-overlay__indicator" role={error ? "alert" : "status"} aria-live="polite">
        {!error ? <span className="route-loading-overlay__spinner" aria-hidden="true" /> : null}
        <span>{error || label}</span>
        {error && onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}
      </div>
    </main>
  );
}
