import { ArrowLeft } from "lucide-react";

// shared page frame
export default function AuthPanel({
  ariaLabel,
  children,
  isBackDisabled = false,
  onBack,
  title
}) {
  return (
    <main className="auth-shell">
      <section className="auth-layout" aria-label={ariaLabel}>
        <div className="login-panel">
          <div className="brand-lockup">
            {onBack ? (
              <button
                aria-label="Back to public user dashboard"
                className="icon-button"
                disabled={isBackDisabled}
                onClick={onBack}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </button>
            ) : null}
            <div>
              <h1>{title}</h1>
            </div>
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}
