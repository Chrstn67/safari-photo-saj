// frontend/src/pages/DiapoPage.jsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../utils/api.js";
import { subscribe } from "../utils/realtime.js";

export default function DiapoPage() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState("loading");
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [allPhotos, setAllPhotos] = useState([]);
  const [resultsData, setResultsData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  // Vérifier l'état global
  const checkStatus = useCallback(async () => {
    try {
      console.log("[DIAPO] Checking status...");
      const statusData = await api.get("/slideshow/status");
      console.log("[DIAPO] Status received:", statusData);
      setStatus(statusData);

      if (statusData.resultsPublished) {
        await loadResultsData();
        setMode("results");
      } else if (statusData.hasOpenSession && statusData.hasCurrentPhoto) {
        await loadCurrentPhoto();
        setMode("notation");
      } else if (statusData.hasCompletedSession) {
        await loadAllPhotos();
        setMode("gallery");
      } else {
        setMode("waiting");
      }
      setError(null);
    } catch (e) {
      console.error("[DIAPO] Erreur status:", e);
      setError(e.message);
      setMode("error");
    }
  }, []);

  const loadCurrentPhoto = async () => {
    try {
      console.log("[DIAPO] Loading current photo...");
      const data = await api.get("/slideshow/current");
      console.log("[DIAPO] Current photo response:", data);
      if (data.hasPhoto && data.photo) {
        setCurrentPhoto(data.photo);
        setCurrentCategory(data.category);
      } else {
        setCurrentPhoto(null);
      }
    } catch (e) {
      console.error("[DIAPO] Erreur chargement photo:", e);
    }
  };

  const loadAllPhotos = async () => {
    try {
      const sessions = await api.get("/deliberations");
      const completedSession = sessions?.find((s) => s.status === "completed");
      if (completedSession?.category_id) {
        const data = await api.get(
          `/slideshow/all-photos/${completedSession.category_id}`,
        );
        setAllPhotos(data.photos || []);
      }
    } catch (e) {
      console.error("[DIAPO] Erreur chargement toutes photos:", e);
    }
  };

  const loadResultsData = async () => {
    try {
      const data = await api.get("/slideshow/results-data");
      setResultsData(data);
    } catch (e) {
      console.error("[DIAPO] Erreur chargement résultats:", e);
    }
  };

  // Rafraîchissement périodique (toutes les 3 secondes)
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Écouter les changements en temps réel
  useEffect(() => {
    // Écouter les changements de sessions
    const unsubSessions = subscribe("deliberation_sessions", "*", (payload) => {
      console.log("[DIAPO] Session changed:", payload);
      checkStatus();
    });

    // Écouter les changements de validations (pour déclencher le rafraîchissement)
    const unsubValidations = subscribe("jury_validations", "*", () => {
      console.log("[DIAPO] Validation changed, checking next photo...");
      checkStatus();
    });

    // Écouter les changements de résultats
    const unsubResults = subscribe("results", "*", () => {
      console.log("[DIAPO] Results changed");
      checkStatus();
    });

    return () => {
      unsubSessions();
      unsubValidations();
      unsubResults();
    };
  }, [checkStatus]);

  // Si pas encore de statut
  if (mode === "loading") {
    return (
      <div className="diapo-loading">
        <div className="spinner spinner-lg" />
        <p>Chargement du diaporama...</p>
      </div>
    );
  }

  // Mode notation - photo en cours
  if (mode === "notation" && currentPhoto?.url) {
    return (
      <div className="diapo-container">
        <div className="diapo-photo">
          <img
            src={currentPhoto.url}
            alt={`Photo ${currentPhoto.anonymous_id}`}
          />
        </div>
        {currentCategory && (
          <div className="diapo-category">{currentCategory}</div>
        )}
        <div className="diapo-anonymous-id">{currentPhoto.anonymous_id}</div>
        <div className="diapo-status">📸 Notation en cours...</div>
      </div>
    );
  }

  // Mode notation mais pas de photo (en attente)
  if (mode === "notation" && !currentPhoto) {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="diapo-waiting-content">
          <div className="waiting-icon">📸</div>
          <h1>En attente de la première photo...</h1>
          <p>La session est ouverte mais aucune photo n'est chargée.</p>
        </div>
      </div>
    );
  }

  // Mode galerie - toutes les photos
  if (mode === "gallery" && allPhotos.length > 0) {
    return (
      <div className="diapo-container diapo-gallery">
        <h1 className="diapo-title">📸 Toutes les photos notées</h1>
        <div className="diapo-photo-grid">
          {allPhotos.map((photo) => (
            <div key={photo.id} className="diapo-photo-item">
              {photo.url && <img src={photo.url} alt="" />}
            </div>
          ))}
        </div>
        <div className="diapo-status">🎬 Fin de la notation</div>
      </div>
    );
  }

  // Mode résultats
  if (mode === "results" && resultsData?.published) {
    // Affichage simplifié des résultats pour le diaporama
    return (
      <div className="diapo-container diapo-results">
        <h1 className="results-title">🏆 RÉSULTATS DU CONCOURS 🏆</h1>
        <div className="results-content">
          {resultsData.categoryWinners?.map((winner, idx) => (
            <div key={idx} className="result-card">
              <h3>{winner.categoryName}</h3>
              {winner.url && <img src={winner.url} alt="" />}
              <p className="winner-id">{winner.anonymousId}</p>
              <p className="winner-score">
                {winner.averageScore?.toFixed(1)}/20
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Mode erreur
  if (mode === "error") {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="diapo-waiting-content">
          <div className="waiting-icon">⚠️</div>
          <h1>Erreur de chargement</h1>
          <p>{error || "Impossible de charger le diaporama."}</p>
          <button className="btn btn-primary" onClick={checkStatus}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // En attente
  return (
    <div className="diapo-container diapo-waiting">
      <div className="diapo-waiting-content">
        <div className="waiting-icon">📺</div>
        <h1>Diaporama en attente</h1>
        <p>La session de notation n'a pas encore commencé.</p>
        {status?.openSession && (
          <div className="waiting-details">
            <p>Session ouverte mais en attente de photo...</p>
            <p className="small">
              Catégorie: {status.openSession.categoryName}
            </p>
            <button className="btn btn-primary" onClick={checkStatus}>
              Rafraîchir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
