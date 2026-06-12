// frontend/src/pages/DiapoPage.jsx
import { useState, useEffect, useCallback } from "react";
import { api } from "../../server/utils/api.js";
import { subscribe } from "../../server/utils/realtime.js";

export default function DiapoPage() {
  const [mode, setMode] = useState("notation"); // 'notation' | 'gallery' | 'results'
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [allPhotos, setAllPhotos] = useState([]);
  const [resultsData, setResultsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({
    hasOpenSession: false,
    hasCompletedSession: false,
    resultsPublished: false,
  });

  // Vérifier l'état global
  const checkStatus = useCallback(async () => {
    try {
      const statusData = await api.get("/slideshow/status");
      console.log("[DIAPO] Status:", statusData);
      setStatus(statusData);

      if (statusData.resultsPublished) {
        // Mode résultats
        await loadResultsData();
        setMode("results");
      } else if (statusData.hasOpenSession) {
        // Mode notation - photo en cours
        await loadCurrentPhoto();
        setMode("notation");
      } else if (statusData.hasCompletedSession) {
        // Mode galerie - toutes les photos
        await loadAllPhotos();
        setMode("gallery");
      } else {
        // En attente
        setMode("waiting");
      }
    } catch (e) {
      console.error("[DIAPO] Erreur status:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Charger la photo en cours
  const loadCurrentPhoto = async () => {
    try {
      const data = await api.get("/slideshow/current");
      console.log("[DIAPO] Current photo data:", data);

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

  // Charger toutes les photos
  const loadAllPhotos = async () => {
    try {
      // D'abord récupérer la catégorie de la session terminée
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

  // Charger les résultats
  const loadResultsData = async () => {
    try {
      const data = await api.get("/slideshow/results-data");
      setResultsData(data);
    } catch (e) {
      console.error("[DIAPO] Erreur chargement résultats:", e);
    }
  };

  // Rafraîchissement périodique (toutes les 5 secondes)
  useEffect(() => {
    const interval = setInterval(() => {
      checkStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [checkStatus]);

  // Écouter les changements en temps réel
  useEffect(() => {
    checkStatus();

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

  if (loading) {
    return (
      <div className="diapo-loading">
        <div className="spinner spinner-lg" />
        <p>Chargement du diaporama...</p>
      </div>
    );
  }

  // Mode notation - photo en cours
  if (mode === "notation") {
    if (currentPhoto && currentPhoto.url) {
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
    } else {
      return (
        <div className="diapo-container diapo-waiting">
          <div className="diapo-waiting-content">
            <div className="waiting-icon">📸</div>
            <h1>Chargement de la photo...</h1>
            <p>Veuillez patienter</p>
          </div>
        </div>
      );
    }
  }

  // Mode galerie - toutes les photos
  if (mode === "gallery" && allPhotos.length > 0) {
    return (
      <div className="diapo-container diapo-gallery">
        <h1 className="diapo-title">📸 Toutes les photos notées</h1>
        <div className="diapo-photo-grid">
          {allPhotos.map((photo, idx) => (
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
        <div className="results-step">
          <h1 className="results-title">🏆 RÉSULTATS 🏆</h1>
          <div className="results-end">
            <div className="end-icon">🎉</div>
            <p>Les résultats seront affichés ici</p>
          </div>
        </div>
      </div>
    );
  }

  // En attente d'une session
  return (
    <div className="diapo-container diapo-waiting">
      <div className="diapo-waiting-content">
        <div className="waiting-icon">📺</div>
        <h1>Diaporama en attente</h1>
        <p>La session de notation n'a pas encore commencé.</p>
        <p style={{ fontSize: "0.8rem", marginTop: "1rem", color: "#666" }}>
          Statut: Session ouverte? {status.hasOpenSession ? "Oui" : "Non"}
          <br />
          Session terminée? {status.hasCompletedSession ? "Oui" : "Non"}
          <br />
          Résultats publiés? {status.resultsPublished ? "Oui" : "Non"}
        </p>
      </div>
    </div>
  );
}
