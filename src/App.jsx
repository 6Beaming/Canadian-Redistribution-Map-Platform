import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";
import DashboardGraphs from "./pages/DashboardGraphs.jsx";
import UserHome from "./pages/UserHome.jsx";
import Header from "./pages/Header.jsx";
import MySubmissions from "./pages/MySubmissions.jsx";

function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/submissions" element={<MySubmissions />} />
        <Route path="/users" element={<UserHome />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/dashboard" element={<DashboardHome />} />
      <Route path="/dashboard/graphs" element={<DashboardGraphs />} />
      </Routes>
    </>
  );
}

export default App;
