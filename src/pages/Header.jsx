import { useState } from "react";
import { ArrowLeft, UserPlus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ProfileControl } from "@/components/non_prebuilt/ProfileControl.jsx";
import { ThemeBrandBox } from "@/components/non_prebuilt/ThemeBrandBox.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  const isUsersHome = pathname === "/" || pathname === "/users";
  const isUserMapSurface =
    isUsersHome ||
    pathname === "/users/search-da" ||
    pathname === "/users/profile";
  const isDashboardPage =
    pathname.startsWith("/dashboard") && pathname !== "/dashboard/workspace";
  const isSubmissionsPage = pathname === "/submissions";
  const isSubmissionDetailPage = pathname.startsWith("/submissions/");
  const isWorkspacePage = pathname === "/dashboard/workspace";
  const isUserSubmissionSurface = isSubmissionsPage || isSubmissionDetailPage;
  const isUserSurface = isUserMapSurface || isUserSubmissionSurface;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sessionStatus, signOut, user } = useAuth();

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

  if (isWorkspacePage) {
    return null;
  }

  return (
    <header
      className={`header relative h-16 w-full border-b border-[#d7e6fb] bg-[#f6efdf] text-[#17324d]${isUserMapSurface ? " header--user-map-surface" : ""}${isDashboardPage ? " header--dashboard-surface" : ""}`}
    >
      <div
        className={`header__left-slot absolute inset-y-0 left-0 flex items-center gap-3 ${isUserMapSurface || isDashboardPage ? "" : "px-4 md:px-6"}`}
      >
        {isDashboardPage ? (
          <ProfileControl
            user={user}
            sessionStatus={sessionStatus}
            isSubmitting={isSubmitting}
            onSignIn={() => navigate("/sign-in")}
            onSignOut={handleSignOut}
            onPrimaryAction={() => navigate("/dashboard/profile")}
            primaryActionLabel="Invite A New Colleague"
            primaryActionIcon={UserPlus}
            edgeAligned
          />
        ) : isUserMapSurface ? (
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

        {isSubmissionsPage ? (
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={() => navigate("/users")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : null}

        {isSubmissionDetailPage ? (
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={() => navigate("/submissions")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : null}
      </div>

      <div className="header__brand-slot pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">
          <ThemeBrandBox />
        </div>
      </div>

      <div className="header__right-slot absolute inset-y-0 right-0 flex items-center justify-end gap-3 px-4 md:px-6">
        {isUserSubmissionSurface ? (
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

        {!isDashboardPage && !isUserSurface ? <div className="h-10 w-10" /> : null}
      </div>
    </header>
  );
}
