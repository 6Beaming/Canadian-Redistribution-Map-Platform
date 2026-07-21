import { useState } from "react";
import { ArrowLeft, ClipboardList, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PlaceSearch } from "@/components/non_prebuilt/PlaceSearch.jsx";
import { ProfileControl } from "@/components/non_prebuilt/ProfileControl.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

const AUTH_PATHS = new Set([
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
  "/sign-in",
  "/sign-up"
]);

function getBackRoute(pathname, isCommissioner) {
  if (pathname.startsWith("/dashboard/archivedTree/") && pathname.endsWith("/difference")) {
    return "/dashboard/archivedTree";
  }

  if (pathname.startsWith("/dashboard/workspace/")) {
    return "/dashboard/workspace";
  }

  if (pathname === "/submissions") {
    return isCommissioner ? "/dashboard" : "/users";
  }

  if (pathname === "/users/profile") {
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

export default function Header({ onPlaceSelect }) {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sessionStatus, signOut, user } = useAuth();

  if (AUTH_PATHS.has(pathname)) {
    return null;
  }

  const isCommissioner = user?.role === "commissioner";
  const backRoute = getBackRoute(pathname, isCommissioner);
  const isCommissionerSurface =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isWorkspaceReview = pathname.startsWith("/dashboard/workspace/");
  const isArchivedDifference = pathname.startsWith("/dashboard/archivedTree/") && pathname.endsWith("/difference");
  const isPublicProfilePage = pathname === "/users/profile";
  const isPublicSubmissionsPage =
    pathname === "/submissions" || pathname.startsWith("/submissions/");
  // A Commissioner may reach the user-submissions route from an existing link.
  // Keep its navigation/profile context commissioner-owned and never expose the
  // public-only "My Submissions" header action on that route.
  const isCommissionerContext = isCommissionerSurface || (isCommissioner && isPublicSubmissionsPage);
  const showSearch =
    (!isCommissionerSurface || pathname === "/dashboard") &&
    !isPublicProfilePage &&
    !isPublicSubmissionsPage;

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
    <header className="header relative z-50 grid h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-[#d7e6fb] bg-background text-[#17324d]">
      <div className="header__left-slot z-10 flex min-w-0 items-center px-[clamp(0.4rem,1.2vw,1rem)]">
        {backRoute && isCommissionerContext ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="header__nav-button"
            onClick={() => navigate(backRoute)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{isWorkspaceReview ? "Back to Workspace" : isArchivedDifference ? "Back to Archived Tree" : "Back to Map"}</span>
          </Button>
        ) : backRoute && (isPublicProfilePage || pathname === "/submissions") ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="header__nav-button"
            onClick={() => navigate(backRoute)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Map</span>
          </Button>
        ) : backRoute ? (
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

      {showSearch ? (
        <div className={`header__search-slot${isCommissionerSurface ? " header__search-slot--commissioner" : ""}`}>
          <PlaceSearch onPlaceSelect={onPlaceSelect} />
        </div>
      ) : null}

      <div className="header__right-slot z-10 flex min-w-0 items-center justify-end gap-[clamp(0.35rem,1vw,1rem)] px-[clamp(0.4rem,1.2vw,1rem)]">
        {isCommissionerSurface && pathname !== "/dashboard/submissionsTable" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-current={pathname === "/dashboard/submissionsTable" ? "page" : undefined}
            aria-label="User submissions"
            className="header__nav-button"
            onClick={() => navigate("/dashboard/submissionsTable")}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            <span>User Submissions</span>
          </Button>
        ) : !isCommissioner && !isPublicProfilePage && !isPublicSubmissionsPage && sessionStatus === "signed-in" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-current={pathname.startsWith("/submissions") ? "page" : undefined}
            aria-label="My Submissions"
            className="header__nav-button"
            onClick={() => navigate("/submissions")}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            <span>My Submissions</span>
          </Button>
        ) : null}

        <ProfileControl
          user={user}
          sessionStatus={sessionStatus}
          isSubmitting={isSubmitting}
          onSignIn={() => navigate("/sign-in")}
          onSignOut={handleSignOut}
          onPrimaryAction={() =>
            navigate(isCommissionerContext ? "/dashboard/profile" : "/users/profile")
          }
          primaryActionLabel="My profile"
          primaryActionIcon={UserRound}
        />
      </div>
    </header>
  );
}
