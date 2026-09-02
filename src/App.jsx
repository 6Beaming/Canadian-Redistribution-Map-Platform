import { useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import { RealtimeProvider } from "./contexts/RealtimeContext.jsx";
import {
  MapFullscreenProvider,
  useMapFullscreen,
} from "./contexts/MapFullscreenContext.jsx";
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
import RealtimeHarness from "./pages/RealtimeHarness.jsx";
import { RouteLoadingOverlay } from "./components/non_prebuilt/RouteLoadingOverlay.jsx";
import { RouteLoadingProvider } from "./contexts/RouteLoadingContext.jsx";
import { RouteLoadingPage } from "./components/non_prebuilt/RouteLoadingPage.jsx";
import { Toaster } from "@/components/ui/sonner";

function RequireCommissioner() {
  const { sessionStatus, user } = useAuth();

  if (sessionStatus === "checking") {
    return <RouteLoadingPage />;
  }

  if (sessionStatus === "signed-out") {
    return <Navigate to="/sign-in" replace />;
  }

  if (user?.role !== "commissioner") {
    return <Navigate to="/users" replace />;
  }

  return <Outlet />;
}

// Public map and personal-submission routes must never become a fallback
// surface for a signed-in Commissioner. The server enforces the same boundary
// for public submission APIs.
function RequirePublicUser() {
  const { sessionStatus, user } = useAuth();

  if (sessionStatus === "checking") {
    return <RouteLoadingPage />;
  }

  if (user?.role === "commissioner") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

function AppRoutes() {
  const [mapSearchTarget, setMapSearchTarget] = useState(null);
  const { isFullscreen } = useMapFullscreen();

  function handlePlaceSelect(place) {
    setMapSearchTarget({
      ...place,
      requestId: Date.now(),
    });
  }

  function handleMapSearchClear() {
    setMapSearchTarget(null);
  }

  return (
    <>
      {!isFullscreen ? <Header onPlaceSelect={handlePlaceSelect} /> : null}
      <div className={`app-route-content${isFullscreen ? " app-route-content--fullscreen" : ""}`}>
        <Routes>
          <Route element={<RequirePublicUser />}>
            <Route
              path="/"
              element={(
                <UserHome
                  mapSearchTarget={mapSearchTarget}
                  onClearMapSearchTarget={handleMapSearchClear}
                />
              )}
            />
            <Route
              path="/users"
              element={(
                <UserHome
                  mapSearchTarget={mapSearchTarget}
                  onClearMapSearchTarget={handleMapSearchClear}
                />
              )}
            />
            <Route path="/users/profile" element={<UserProfile />} />
            <Route path="/submissions" element={<MySubmissions />} />
            <Route
              path="/submissions/:submissionId"
              element={<UserResumeSubmission />}
            />
          </Route>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/sign-up" element={<SignUpPage />} />
          <Route path="/forgot-password" element={<ResetPasswordRequestPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/reset-password" element={<PasswordRecoveryPage />} />

          <Route element={<RequireCommissioner />}>
            <Route path="/dashboard" element={<DashboardHome mapSearchTarget={mapSearchTarget} />} />
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
            <Route
              path="/dashboard/realtime-harness"
              element={import.meta.env.DEV ? <RealtimeHarness /> : <Navigate to="/dashboard" replace />}
            />
          </Route>
        </Routes>
      </div>
      <RouteLoadingOverlay />
      <Toaster position="top-center" offset={isFullscreen ? "16px" : "80px"} closeButton />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <RealtimeProvider>
        <MapFullscreenProvider>
          <RouteLoadingProvider>
            <AppRoutes />
          </RouteLoadingProvider>
        </MapFullscreenProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}

export default App;
