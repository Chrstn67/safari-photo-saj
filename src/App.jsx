// frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../server/hooks/useAuth.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import ParticipantPage from "./pages/ParticipantPage.jsx";
import JuryPage from "./pages/JuryPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import DiapoPage from "./pages/DiapoPage.jsx";
import "./styles/global.css";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
        }}
      >
        <span className="spinner spinner-lg" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    if (user.role === "admin") return <Navigate to="/admin" replace />;
    if (user.role === "juror") return <Navigate to="/jury" replace />;
    if (user.role === "participant")
      return <Navigate to="/participant" replace />;
    if (user.role === "diapo") return <Navigate to="/diapo" replace />;
    return <Navigate to="/login" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) {
    // Redirection uniquement pour le compte DIAPO (prénom et nom spécifiques)
    if (user.firstName === "DIAPO" && user.lastName === "SAJ") {
      return <Navigate to="/diapo" replace />;
    }
    // Redirection normale pour les autres
    if (user.role === "admin") return <Navigate to="/admin" replace />;
    if (user.role === "juror") return <Navigate to="/jury" replace />;
    if (user.role === "participant")
      return <Navigate to="/participant" replace />;
    if (user.role === "diapo") return <Navigate to="/diapo" replace />;
    return <Navigate to="/participant" replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicRoute>
                <RegisterPage />
              </PublicRoute>
            }
          />
          <Route
            path="/participant"
            element={
              <ProtectedRoute roles={["participant"]}>
                <ParticipantPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jury"
            element={
              <ProtectedRoute roles={["juror", "admin"]}>
                <JuryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={["admin"]}>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/diapo"
            element={
              <ProtectedRoute roles={["diapo"]}>
                <DiapoPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
