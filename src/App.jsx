import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashboardGraphs from "./pages/DashboardGraphs.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage/>} />
      <Route path="/dashboard" element={<DashboardHome />} />
      <Route path="/dashboard/graphs" element={<DashboardGraphs />} />
    </Routes>

  );
}

export default App;