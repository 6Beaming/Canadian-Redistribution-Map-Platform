import { useState } from "react";
import { ArrowLeft, Search, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ProfileControl } from "@/components/non_prebuilt/ProfileControl.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

const AUTH_PATHS = new Set([
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
  "/sign-in",
  "/sign-up"
]);

function getBackRoute(pathname) {
  if (
    pathname === "/users/search-da" ||
    pathname === "/submissions"
  ) {
    return "/users";
  }

  if (pathname.startsWith("/submissions/")) {
    return "/submissions";
  }

  if (pathname.startsWith("/dashboard/")) {
    return "/dashboard";
  }

  return null;
}

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sessionStatus, signOut, user } = useAuth();

  if (AUTH_PATHS.has(pathname)) {
    return null;
  }

  const backRoute = getBackRoute(pathname);
  const isCommissionerSurface =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  async function handleSignOut() {
    if (sessionStatus !== "signed-in") {
      navigate("/sign-in");
      return;
    }

    setIsSubmitting(true);

    try {
      await signOut();
      navigate("/sign-in", { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <header className="header relative z-50 h-14 w-full border-b border-[#d7e6fb] bg-background text-[#17324d]">
      <div className="header__left-slot absolute inset-y-0 left-0 z-10 flex items-center px-3 md:px-4">
        {backRoute ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full bg-white"
            aria-label="Go back"
            onClick={() => navigate(backRoute)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : null}
      </div>

      <div className="header__search-slot">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 h-4 w-4 text-[#607086]"
        />
        <input
          type="search"
          aria-label="Search by address or postal code"
          className="h-10 w-full rounded-full border border-[#c9d8eb] bg-white py-2 pl-11 pr-4 text-sm text-[#17324d] shadow-[0_2px_8px_rgba(23,50,77,0.06)] outline-none transition-[border-color,box-shadow] placeholder:text-[#7a8797] focus:border-[#1a73e8] focus:shadow-[0_0_0_3px_rgba(26,115,232,0.14)]"
          placeholder="Search by address or postal code..."
        />
      </div>

      <div className="header__right-slot absolute inset-y-0 right-0 z-10 flex items-center justify-end px-3 md:px-4">
        <ProfileControl
          user={user}
          sessionStatus={sessionStatus}
          isSubmitting={isSubmitting}
          onSignIn={() => navigate("/sign-in")}
          onSignOut={handleSignOut}
          onPrimaryAction={() =>
            navigate(isCommissionerSurface ? "/dashboard/profile" : "/users/profile")
          }
          primaryActionLabel="My profile"
          primaryActionIcon={UserRound}
        />
      </div>
    </header>
  );
}
