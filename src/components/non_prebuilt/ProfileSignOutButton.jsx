import { useState } from "react";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext.jsx";

export function ProfileSignOutButton() {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { signOut } = useAuth();

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await signOut();
      navigate("/sign-in", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <Button
      variant="outline"
      className="w-fit"
      disabled={isSigningOut}
      onClick={handleSignOut}
    >
      <LogOut className="h-4 w-4" />
      {isSigningOut ? "Signing Out" : "Sign Out"}
    </Button>
  );
}
