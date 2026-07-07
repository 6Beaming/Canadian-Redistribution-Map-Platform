import { LogIn, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext.jsx";

export function HeaderAuthButton() {
  const navigate = useNavigate();
  const { sessionStatus, user } = useAuth();
  const isChecking = sessionStatus === "checking";
  const isSignedIn = sessionStatus === "signed-in";

  function handleClick() {
    if (!isSignedIn) {
      navigate("/sign-in");
      return;
    }

    navigate(
      user?.role === "commissioner"
        ? "/dashboard/profile"
        : "/users/profile",
    );
  }

  return (
    <Button
      aria-label={
        isChecking
          ? "Checking sign-in status"
          : isSignedIn
            ? "Open my profile"
            : undefined
      }
      className={
        isSignedIn
          ? "rounded-full border-white bg-transparent text-white hover:bg-gray-700 hover:text-white"
          : "min-w-28 border-white bg-transparent text-white hover:bg-gray-700 hover:text-white"
      }
      disabled={isChecking}
      onClick={handleClick}
      size={isSignedIn ? "icon" : "default"}
      title={isSignedIn ? "My Profile" : undefined}
      variant="outline"
    >
      {isChecking ? (
        <span aria-live="polite">Loading</span>
      ) : isSignedIn ? (
        <User className="h-4 w-4" />
      ) : (
        <>
          <LogIn className="h-4 w-4" />
          Sign In
        </>
      )}
    </Button>
  );
}
