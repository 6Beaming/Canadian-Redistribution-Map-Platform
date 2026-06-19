import { Routes, Route } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashboardPublicUser from "./pages/DashboardPublicUser.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/reset-password" element={<AuthPage />} />
      <Route path="/dashboard" element={<DashboardHome />} />
      <Route path="/dashboard-public-user" element={<DashboardPublicUser />} />
    </Routes>
  );
}

export default App;
