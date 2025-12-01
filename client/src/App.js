// client/src/App.js
import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";

import SignIn from "./SignIn";
import CreateAccount from "./CreateAccount";
import Welcome from "./Welcome";

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  // Load saved login session
  useEffect(() => {
    const saved = localStorage.getItem("auth_user");
    if (saved) {
      setUser(JSON.parse(saved));
    }
  }, []);

  // Called when SignIn is successful
  function handleAuth(userData) {
    setUser(userData);
    navigate("/welcome");
  }

  return (
    <Routes>

      {/* PUBLIC ROUTES */}
      <Route
        path="/"
        element={<SignIn onAuth={handleAuth} onShowRegister={() => navigate("/register")} />}
      />

      <Route
        path="/register"
        element={<CreateAccount onShowLogin={() => navigate("/")} />}
      />

      {/* PROTECTED ROUTE */}
      <Route
        path="/welcome"
        element={user ? <Welcome /> : <Navigate to="/" replace />}
      />

      {/* DEFAULT REDIRECT */}
      <Route path="*" element={<Navigate to="/" replace />} />

    </Routes>
  );
}
