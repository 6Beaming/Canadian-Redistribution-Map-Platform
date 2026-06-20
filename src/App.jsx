import { Routes, Route } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardCommissioner from "./pages/DashboardCommissioner.jsx";
import DashboardPublicUser from "./pages/DashboardPublicUser.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPublicUser />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/reset-password" element={<AuthPage />} />
      <Route path="/commissioner" element={<DashboardCommissioner />} />
    </Routes>
  );
}

export default App;
