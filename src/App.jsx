import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import Header from "./pages/Header.jsx";
import AcceptInvitePage from "./pages/AcceptInvitePage.jsx";
import ArchivedTree from "./pages/ArchivedTree.jsx";
import ArchivedDifference from "./pages/ArchivedDifference.jsx";
import CommissionerProfile from "./pages/CommissionerProfile.jsx";
import CommissionerWorkspace from "./pages/CommissionerWorkspace.jsx";
import WorkspaceReview from "./pages/WorkspaceReview.jsx";
import DashboardGraphs from "./pages/DashboardGraphs.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashBoardSubmissionsPage from "./pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx";
import MySubmissions from "./pages/MySubmissions.jsx";
import PasswordRecoveryPage from "./pages/PasswordRecoveryPage.jsx";
import ResetPasswordRequestPage from "./pages/ResetPasswordRequestPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import UserHome from "./pages/UserHome.jsx";
import UserProfile from "./pages/UserProfile.jsx";
import UserResumeSubmission from "./pages/UserResumeSubmission.jsx";
import { Toaster } from "@/components/ui/sonner";

function RequireCommissioner() {
  const { sessionStatus, user } = useAuth();

  if (sessionStatus === "checking") {
    return null;
  }

  if (sessionStatus === "signed-out") {
    return <Navigate to="/sign-in" replace />;
  }

  if (user?.role !== "commissioner") {
    return <Navigate to="/users" replace />;
  }

  return <Outlet />;
}

function App() {
  return (
    <AuthProvider>
      <Header />

      <Routes>
        <Route path="/" element={<UserHome />} />
        <Route path="/users" element={<UserHome />} />
        <Route path="/users/profile" element={<UserProfile />} />
        <Route path="/submissions" element={<MySubmissions />} />
        <Route
          path="/submissions/:submissionId"
          element={<UserResumeSubmission />}
        />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ResetPasswordRequestPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/reset-password" element={<PasswordRecoveryPage />} />

        <Route element={<RequireCommissioner />}>
          <Route path="/dashboard" element={<DashboardHome />} />
          <Route path="/dashboard/graphs" element={<DashboardGraphs />} />
          <Route
            path="/dashboard/submissionsTable"
            element={<DashBoardSubmissionsPage />}
          />
          <Route path="/dashboard/profile" element={<CommissionerProfile />} />
          <Route path="/dashboard/workspace" element={<CommissionerWorkspace />} />
          <Route path="/dashboard/workspace/:submissionId" element={<WorkspaceReview />} />
          <Route path="/dashboard/archivedTree" element={<ArchivedTree />} />
          <Route path="/dashboard/archivedTree/:submissionId/difference" element={<ArchivedDifference />} />
        </Route>
      </Routes>
      <Toaster position="top-center" offset="80px" closeButton/>
    </AuthProvider>
  );
}

export default App;
