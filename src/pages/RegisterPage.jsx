// frontend/src/pages/RegisterPage.jsx
// Ce fichier est conservé pour la compatibilité du router
// mais redirige vers la page d'auth unifiée.
import { Navigate } from "react-router-dom";
export default function RegisterPage() {
  return <Navigate to="/login" replace />;
}
