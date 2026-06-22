import {Routes, Route} from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashboardGraphs from "./pages/DashboardGraphs.jsx";
import DashBoardSubmissionsPage from "./pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage/>} />
      <Route path="/dashboard" element={<DashboardHome />} />
      <Route path="/dashboard/graphs" element={<DashboardGraphs />} />
      <Route path="/dashboard/submissionsTable" element={<DashBoardSubmissionsPage />} />
    </Routes>

  );
}

export default App;