import { useState } from "react";
import { ArrowLeft, BarChart3, ClipboardList, Map, ScrollText, Search, UserRound } from "lucide-react";
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
    pathname === "/users/profile" ||
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
  const isPublicProfilePage = pathname === "/users/profile";
  const isPublicSubmissionsPage =
    pathname === "/submissions" || pathname.startsWith("/submissions/");
  const showSearch =
    (!isCommissionerSurface || pathname === "/dashboard") &&
    !isPublicProfilePage &&
    !isPublicSubmissionsPage;
  const mobileProfileActions = isCommissionerSurface
    ? [
        {
          icon: BarChart3,
          label: "Analytics",
          onSelect: () => navigate("/dashboard/graphs"),
        },
        {
          icon: ScrollText,
          label: "Audit Logs",
          onSelect: () => navigate("/dashboard/auditlog"),
        },
        {
          icon: ClipboardList,
          label: "User Submissions",
          onSelect: () => navigate("/dashboard/submissionsTable"),
        },
      ]
    : !isPublicProfilePage && sessionStatus === "signed-in"
      ? [
          {
            icon: ClipboardList,
            label: "My submissions",
            onSelect: () => navigate("/submissions"),
          },
        ]
      : [];

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
    <header className="header relative z-50 flex h-14 w-full items-center justify-center border-b border-[#d7e6fb] bg-background text-[#17324d]">
      <div className="header__left-slot absolute inset-y-0 left-0 z-10 flex items-center px-3 md:px-4">
        {backRoute && isCommissionerSurface ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="header__submissions-link h-10 gap-2 rounded-lg border border-[#8ca3bd] bg-white px-2 py-1.5 text-sm font-semibold text-[#29445f] shadow-[0_1px_3px_rgba(23,50,77,0.06)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[#1a73e8] hover:bg-[#eef5ff] hover:text-[#1a73e8] hover:shadow-[0_3px_8px_rgba(26,115,232,0.12)] md:px-4"
            onClick={() => navigate("/dashboard")}
          >
            <Map className="h-4 w-4" aria-hidden="true" />
            <span>Map View</span>
          </Button>
        ) : backRoute && (isPublicProfilePage || pathname === "/submissions") ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="header__submissions-link h-10 gap-2 rounded-lg border border-[#8ca3bd] bg-white px-2 py-1.5 text-sm font-semibold text-[#29445f] shadow-[0_1px_3px_rgba(23,50,77,0.06)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[#1a73e8] hover:bg-[#eef5ff] hover:text-[#1a73e8] hover:shadow-[0_3px_8px_rgba(26,115,232,0.12)] md:px-4"
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
      ) : null}

      <div className="header__right-slot absolute inset-y-0 right-0 z-10 flex items-center justify-end gap-2 px-3 md:gap-4 md:px-4">
        {isCommissionerSurface ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Analytics"
              className="header__submissions-link hidden h-10 gap-2 rounded-lg border border-[#8ca3bd] bg-white px-2 py-1.5 text-sm font-semibold text-[#29445f] shadow-[0_1px_3px_rgba(23,50,77,0.06)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[#1a73e8] hover:bg-[#eef5ff] hover:text-[#1a73e8] hover:shadow-[0_3px_8px_rgba(26,115,232,0.12)] md:inline-flex md:px-4"
              onClick={() => navigate("/dashboard/graphs")}
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden md:inline">Analytics</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Audit logs"
              className="header__submissions-link hidden h-10 gap-2 rounded-lg border border-[#8ca3bd] bg-white px-2 py-1.5 text-sm font-semibold text-[#29445f] shadow-[0_1px_3px_rgba(23,50,77,0.06)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[#1a73e8] hover:bg-[#eef5ff] hover:text-[#1a73e8] hover:shadow-[0_3px_8px_rgba(26,115,232,0.12)] md:inline-flex md:px-4"
              onClick={() => navigate("/dashboard/auditlog")}
            >
              <ScrollText className="h-4 w-4" aria-hidden="true" />
              <span className="hidden md:inline">Audit Logs</span>
            </Button>
          </>
        ) : null}

        {isCommissionerSurface ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-current={pathname === "/dashboard/submissionsTable" ? "page" : undefined}
            aria-label="User submissions"
            className="header__submissions-link hidden h-10 gap-2 rounded-lg border border-[#8ca3bd] bg-white px-2 py-1.5 text-sm font-semibold text-[#29445f] shadow-[0_1px_3px_rgba(23,50,77,0.06)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[#1a73e8] hover:bg-[#eef5ff] hover:text-[#1a73e8] hover:shadow-[0_3px_8px_rgba(26,115,232,0.12)] md:inline-flex md:px-4"
            onClick={() => navigate("/dashboard/submissionsTable")}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">User Submissions</span>
          </Button>
        ) : !isPublicProfilePage && sessionStatus === "signed-in" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-current={pathname.startsWith("/submissions") ? "page" : undefined}
            aria-label="My submissions"
            className="header__submissions-link hidden h-10 gap-2 rounded-lg border border-[#8ca3bd] bg-white px-2 py-1.5 text-sm font-semibold text-[#29445f] shadow-[0_1px_3px_rgba(23,50,77,0.06)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[#1a73e8] hover:bg-[#eef5ff] hover:text-[#1a73e8] hover:shadow-[0_3px_8px_rgba(26,115,232,0.12)] md:inline-flex md:px-4"
            onClick={() => navigate("/submissions")}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">My submissions</span>
          </Button>
        ) : null}

        <ProfileControl
          user={user}
          sessionStatus={sessionStatus}
          isSubmitting={isSubmitting}
          menuActions={mobileProfileActions}
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
