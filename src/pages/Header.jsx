import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, LogIn, LogOut } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function Header() {
  const navigate = useNavigate();

  const location = useLocation();
  const isUsersPage = location.pathname === "/" || location.pathname === "/users";
  const isDashboardPage = location.pathname.startsWith("/dashboard");
  const isSubmissionsPage = location.pathname === "/submissions";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sessionStatus, signOut, user } = useAuth();
  const canUseCommissionerNav =
    isDashboardPage && sessionStatus === "signed-in" && user?.role === "commissioner";

  async function handleAuthAction() {
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

  function AuthActionButton() {
    const isSignedIn = sessionStatus === "signed-in";
    const Icon = isSignedIn ? LogOut : LogIn;
    const label = isSubmitting
      ? "Signing Out"
      : isSignedIn
        ? "Sign Out"
        : "Sign In";

    return (
      <Button
        variant="outline"
        className="min-w-28 border-white bg-transparent text-white hover:bg-gray-700 hover:text-white"
        disabled={isSubmitting}
        onClick={handleAuthAction}
      >
        <Icon className="h-4 w-4" />
        {label}
      </Button>
    );
  }

  if (canUseCommissionerNav) {
    return (
      <div className="grid h-16 w-full grid-cols-[1fr_auto_1fr] items-center border-b border-gray-700 bg-gray-800 px-6 text-white">
        <div />
        <Button
          variant="outline"
          className="justify-self-center border-white bg-transparent text-white hover:bg-gray-700 hover:text-white"
          onClick={() => navigate("/dashboard/submissionsTable")}
        >
          All Submissions
        </Button>
        <div className="justify-self-end">
          <AuthActionButton />
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-16 bg-gray-800 text-white flex items-center px-6 border-b border-gray-700">
      <div className="flex-1" />

      {isUsersPage && sessionStatus === "signed-in" && (
        <Button
          onClick={() => navigate("/submissions")}
          className="bg-transparent border border-white text-white hover:bg-gray-700"
        >
          My Submissions
        </Button>
      )}

      {isUsersPage && (
        <p className="absolute left-6 text-lg font-semibold">Home</p>
      )}

      {isUsersPage && (
        <div className="flex-1 flex justify-end">
          <AuthActionButton />
        </div>
      )}

      {isSubmissionsPage && (
        <>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full absolute left-5.5 bg-black"
            onClick={() => navigate("/users")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-lg font-semibold">My Submissions</p>
          </div>
          <div className="flex-1" />
          <div className="absolute right-6">
            <AuthActionButton />
          </div>
        </>
      )}
    </div>
  );
}
