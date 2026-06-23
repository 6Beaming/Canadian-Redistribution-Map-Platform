import {Routes, Route} from "react-router-dom";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashboardGraphs from "./pages/DashboardGraphs.jsx";
import DashBoardSubmissionsPage from "./pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx";
import UserHome from "./pages/UserHome.jsx";
import Header from "./pages/Header.jsx";
import MySubmissions from "./pages/MySubmissions.jsx";

import CommissionerSignUpPage from "./pages/CommissionerSignUpPage.jsx";
import DashboardCommissioner from "./pages/DashboardCommissioner.jsx";
import PasswordRecoveryPage from "./pages/PasswordRecoveryPage.jsx";
import ResetPasswordRequestPage from "./pages/ResetPasswordRequestPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";

function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<UserHome />} />
        <Route path="/users" element={<UserHome />} />
        <Route path="/submissions" element={<MySubmissions />} />
        <Route path="/commissioner" element={<DashboardCommissioner />} /> 
        <Route path="/dashboard" element={<DashboardHome />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/commissioner/sign-up" element={<CommissionerSignUpPage />} />
        <Route path="/forgot-password" element={<ResetPasswordRequestPage />} />
        <Route path="/reset-password" element={<PasswordRecoveryPage />} />
        <Route path="/dashboard/graphs" element={<DashboardGraphs />} />
        <Route path="/dashboard/submissionsTable" element={<DashBoardSubmissionsPage />} />
      </Routes>
    </>
  );
}

export default App;

