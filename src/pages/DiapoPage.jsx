// frontend/src/pages/DiapoPage.jsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../server/hooks/useAuth.jsx";
import { api } from "../../server/utils/api.js";
import { subscribe } from "../../server/utils/realtime.js";

export default function DiapoPage() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState("loading");
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [allPhotos, setAllPhotos] = useState([]);
  const [resultsData, setResultsData] = useState(null);
  const [status, setStatus] = useState(null);

  console.log(
    "[DIAPO] Token présent ?",
    !!localStorage.getItem("safari_token"),
  );
  console.log("[DIAPO] User from auth:", user);
  // Vérifier l'état global
  const checkStatus = useCallback(async () => {
    try {
      const statusData = await api.get("/slideshow/status");
      console.log("[DIAPO] Status:", statusData);
      setStatus(statusData);

      if (statusData.resultsPublished) {
        await loadResultsData();
        setMode("results");
      } else if (
        statusData.hasOpenSession &&
        statusData.openSession?.hasCurrentPhoto
      ) {
        await loadCurrentPhoto();
        setMode("notation");
      } else if (statusData.hasCompletedSession) {
        await loadAllPhotos();
        setMode("gallery");
      } else {
        setMode("waiting");
      }
    } catch (e) {
      console.error("[DIAPO] Erreur status:", e);
      setMode("error");
    }
  }, []);

  const loadCurrentPhoto = async () => {
    try {
      const data = await api.get("/slideshow/current");
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

  // Rafraîchissement périodique
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Écouter les changements en temps réel
  useEffect(() => {
    const unsubSessions = subscribe("deliberation_sessions", "*", () => {
      console.log("[DIAPO] Session changed, refreshing...");
      checkStatus();
    });

    const unsubResults = subscribe("results", "*", () => {
      console.log("[DIAPO] Results changed, refreshing...");
      checkStatus();
    });

    return () => {
      unsubSessions();
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
          <img src={currentPhoto.url} alt="" />
        </div>
        {currentCategory && (
          <div className="diapo-category">{currentCategory}</div>
        )}
        <div className="diapo-status">📸 Notation en cours...</div>
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
    return (
      <div className="diapo-container diapo-results">
        <h1 className="results-title">🏆 RÉSULTATS 🏆</h1>
        <div className="results-end">
          <div className="end-icon">🎉</div>
          <p>Les résultats seront affichés ici</p>
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
          <p>Impossible de charger le diaporama.</p>
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
      </div>
    </div>
  );
}
