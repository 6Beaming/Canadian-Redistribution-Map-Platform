import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardHome from "./pages/DashboardHome.jsx";
import UserHome from "./pages/UserHome.jsx";
import Header from "./pages/Header.jsx";

function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/users" element={<UserHome />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/dashboard" element={<DashboardHome />} />
      </Routes>
    </>
  );
}

export default App;
