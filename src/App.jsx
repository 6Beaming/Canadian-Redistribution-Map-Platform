import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/reset-password" element={<AuthPage />} />
      <Route path="/dashboard" element={<DashboardHome />} />
    </Routes>
  );
}

export default App;
