import { useEffect, useState } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ProfileControl } from "@/components/non_prebuilt/ProfileControl.jsx";
import { ThemeBrandBox } from "@/components/non_prebuilt/ThemeBrandBox.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

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

  const isUsersHome = pathname === "/" || pathname === "/users";
  const isDashboardHome = pathname === "/dashboard";
  const backRoute = getBackRoute(pathname);
  const isBackHeaderSurface = Boolean(backRoute);
  const isUserBackSurface =
    pathname === "/users/search-da" ||
    pathname === "/submissions" ||
    pathname.startsWith("/submissions/");
  const isCommissionerBackSurface = pathname.startsWith("/dashboard/");
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 576
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sessionStatus, signOut, user } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 576px)");
    const handleChange = (event) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

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

  const usesEdgeBrandLayout = isMobile && (isUsersHome || isDashboardHome);

  return (
    <header
      className={`header relative h-16 w-full border-b border-[#d7e6fb] bg-[#f6efdf] text-[#17324d]${isUsersHome ? " header--user-map-surface" : ""}${isDashboardHome ? " header--dashboard-surface" : ""}${isBackHeaderSurface ? " header--back-surface" : ""}`}
    >
      <div
        className={`header__left-slot absolute inset-y-0 left-0 flex items-center gap-3 ${isUsersHome || isDashboardHome ? "" : "px-4 md:px-6"}`}
      >
        {isDashboardHome ? (
          <ProfileControl
            user={user}
            sessionStatus={sessionStatus}
            isSubmitting={isSubmitting}
            onSignIn={() => navigate("/sign-in")}
            onSignOut={handleSignOut}
            onPrimaryAction={() => navigate("/dashboard/profile")}
            primaryActionLabel="My Profile"
            primaryActionIcon={UserRound}
            edgeAligned
          />
        ) : null}

        {isUsersHome ? (
          <ProfileControl
            user={user}
            sessionStatus={sessionStatus}
            isSubmitting={isSubmitting}
            onSignIn={() => navigate("/sign-in")}
            onSignOut={handleSignOut}
            onNavigateProfile={() => navigate("/users/profile")}
            edgeAligned
          />
        ) : null}

        {isBackHeaderSurface ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label="Go back"
            onClick={() => navigate(backRoute)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : null}
      </div>

      <div
        className={`header__brand-slot pointer-events-none absolute ${usesEdgeBrandLayout ? "inset-y-0 right-0 flex items-stretch justify-end" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"}`}
        style={
          usesEdgeBrandLayout
            ? {
                width: "50dvw",
                maxWidth: "50dvw",
                minWidth: 0,
                transform: "none"
              }
            : undefined
        }
      >
        <div
          className="pointer-events-auto"
          style={
            usesEdgeBrandLayout
              ? {
                  display: "flex",
                  width: "100%",
                  minWidth: 0,
                  alignItems: "stretch",
                  justifyContent: "flex-end",
                  overflow: "visible"
                }
              : undefined
          }
        >
          <ThemeBrandBox disableMobileExpansion={isBackHeaderSurface && isMobile} />
        </div>
      </div>

      <div className="header__right-slot absolute inset-y-0 right-0 flex items-center justify-end gap-3 px-4 md:px-6">
        {isUserBackSurface ? (
          <ProfileControl
            user={user}
            sessionStatus={sessionStatus}
            isSubmitting={isSubmitting}
            onSignIn={() => navigate("/sign-in")}
            onSignOut={handleSignOut}
            onNavigateProfile={() => navigate("/users/profile")}
            align="right"
          />
        ) : null}

        {isCommissionerBackSurface ? (
          <ProfileControl
            user={user}
            sessionStatus={sessionStatus}
            isSubmitting={isSubmitting}
            onSignIn={() => navigate("/sign-in")}
            onSignOut={handleSignOut}
            onPrimaryAction={() => navigate("/dashboard/profile")}
            primaryActionLabel="My Profile"
            primaryActionIcon={UserRound}
            align="right"
          />
        ) : null}

        {!isUsersHome &&
        !isDashboardHome &&
        !isBackHeaderSurface ? (
          <div className="h-10 w-10" />
        ) : null}
      </div>
    </header>
  );
}
