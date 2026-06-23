import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashboardGraphs from "./pages/DashboardGraphs.jsx";
import DashBoardSubmissionsPage from "./pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx";
import UserHome from "./pages/UserHome.jsx";
import Header from "./pages/Header.jsx";
import MySubmissions from "./pages/MySubmissions.jsx";

import CommissionerSignUpPage from "./pages/CommissionerSignUpPage.jsx"; // This is temporary for demo 1
import PasswordRecoveryPage from "./pages/PasswordRecoveryPage.jsx";
import ResetPasswordRequestPage from "./pages/ResetPasswordRequestPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";

// route guard for commissioner only
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
        <Route path="/submissions" element={<MySubmissions />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/commissioner/sign-up" element={<CommissionerSignUpPage />} />
        <Route path="/forgot-password" element={<ResetPasswordRequestPage />} />
        <Route path="/reset-password" element={<PasswordRecoveryPage />} />
        <Route element={<RequireCommissioner />}>
          <Route path="/dashboard" element={<DashboardHome />} />
          <Route path="/dashboard/graphs" element={<DashboardGraphs />} />
          <Route
            path="/dashboard/submissionsTable"
            element={<DashBoardSubmissionsPage />}
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;
