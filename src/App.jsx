import { Routes, Route } from "react-router-dom";
import DashboardCommissioner from "./pages/DashboardCommissioner.jsx";
import DashboardPublicUser from "./pages/DashboardPublicUser.jsx";
import PasswordRecoveryPage from "./pages/PasswordRecoveryPage.jsx";
import ResetPasswordRequestPage from "./pages/ResetPasswordRequestPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPublicUser />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ResetPasswordRequestPage />} />
      <Route path="/reset-password" element={<PasswordRecoveryPage />} />
      <Route path="/commissioner" element={<DashboardCommissioner />} />
    </Routes>
  );
}

export default App;
