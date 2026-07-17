import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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
              <Button
                aria-label="Back to public user dashboard"
                className="auth-back-button auth-back-button--header"
                disabled={isBackDisabled}
                onClick={onBack}
                type="button"
                variant="ghost"
                size="icon"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </Button>
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
