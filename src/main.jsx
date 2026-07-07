import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/globals.css"
import "./styles/auth.css";
import "./styles/media.css";
import { BrowserRouter } from "react-router-dom";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </BrowserRouter>
);
