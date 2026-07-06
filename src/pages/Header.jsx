import { Button } from "@/components/ui/button";
import { HeaderAuthButton } from "@/components/non_prebuilt/HeaderAuthButton.jsx";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  const isUsersHome = pathname === "/" || pathname === "/users";
  const isUserSurface =
    isUsersHome ||
    pathname === "/users/search-da" ||
    pathname === "/users/profile";
  const isDashboardPage =
    pathname.startsWith("/dashboard") && pathname !== "/dashboard/workspace";
  const isSubmissionsPage = pathname === "/submissions";
  const isSubmissionDetailPage = pathname.startsWith("/submissions/");
  const isWorkspacePage = pathname === "/dashboard/workspace";

  const { sessionStatus } = useAuth();

  if (isWorkspacePage) {
    return null;
  }

  if (isDashboardPage) {
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
        <div className="justify-self-end flex items-center gap-2">
          <HeaderAuthButton />
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-16 bg-gray-800 text-white flex items-center px-6 border-b border-gray-700">
      <div className="flex-1" />

      {isUsersHome && sessionStatus === "signed-in" && (
        <Button
          onClick={() => navigate("/submissions")}
          className="bg-transparent border border-white text-white hover:bg-gray-700"
        >
          My Submissions
        </Button>
      )}

      {isUserSurface && (
        <p className="absolute left-6 text-lg font-semibold">Home</p>
      )}

      {isUserSurface && (
        <div className="flex-1 flex justify-end items-center gap-2">
          <HeaderAuthButton />
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
            <HeaderAuthButton />
          </div>
        </>
      )}

      {isSubmissionDetailPage && (
        <>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full absolute left-5.5 bg-black"
            onClick={() => navigate("/submissions")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-lg font-semibold">Submission</p>
          </div>
          <div className="flex-1" />
          <div className="absolute right-6">
            <HeaderAuthButton />
          </div>
        </>
      )}
    </div>
  );
}
