import { Button } from "@/components/ui/button";
import { useLocation } from "react-router-dom";

export default function Header() {
  const location = useLocation();
  const isUsersPage = location.pathname === "/users";


  return (
    <div className="w-full h-16 bg-gray-800 text-white flex items-center px-6 border-b border-gray-700">
      <div className="flex-1" />

      {isUsersPage && (
        <Button className="bg-transparent border border-white text-white hover:bg-gray-700">
          My Submissions
        </Button>
      )}

      {isUsersPage && (
        <div className="flex-1 flex justify-end">
          <Button variant="outline" className="rounded-full">
            A
          </Button>
        </div>
      )}
    </div>
  );
}
