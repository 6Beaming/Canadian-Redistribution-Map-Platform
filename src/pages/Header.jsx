import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

function mySubmissions() {
  // Implement the logic to navigate to the user's submissions page
  console.log("Navigating to My Submissions");
  window.location.href = "/submissions";
}

function viewSubmissions() {
  // Implement the logic to navigate to the commissioners' view submissions overview page
  console.log("Navigating to View Submissions");
}

export default function Header() {
  const navigate = useNavigate();

  const location = useLocation();
  const isUsersPage = location.pathname === "/users";
  const isAuthPage = location.pathname === "/auth";
  const isDashboardPage = location.pathname === "/dashboard";
  const isSubmissionsPage = location.pathname === "/submissions";

  return (
    <div className="relative w-full h-16 bg-gray-800 text-white flex items-center px-6 border-b border-gray-700">
      <div className="flex-1" />

      {isUsersPage && (
        <Button
          onClick={() => navigate("/submissions")}
          className="bg-transparent border border-white text-white hover:bg-gray-700"
        >
          My Submissions
        </Button>
      )}

      {isUsersPage && (
        <div className="flex-1 flex justify-end">
          <Button variant="outline" className="rounded-full bg-black">
            A
          </Button>
        </div>
      )}

      {isAuthPage && (
        <div className="flex-1 flex justify-end">
          <Button variant="outline" className="rounded-full bg-black">
            A
          </Button>
        </div>
      )}

      {isDashboardPage && (
        <>
          <div className="flex-1 flex justify-center">
            <Button
              onClick={viewSubmissions}
              variant="outline"
              className="rounded-full bg-black"
            >
              View Submissions
            </Button>
          </div>
          <div className="flex-1" />
        </>
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
          <div className="asbolute right-5.5">
            <Button variant="outline" className="rounded-full bg-black">
              A
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
