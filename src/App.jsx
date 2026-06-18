import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage/>} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>

  );
}

export default App;