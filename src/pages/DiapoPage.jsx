// frontend/src/pages/DiapoPage.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../../server/hooks/useAuth.jsx";
import { api } from "../../server/utils/api.js";

export default function DiapoPage() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState("loading");
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [allPhotos, setAllPhotos] = useState([]);
  const [resultsData, setResultsData] = useState(null);
  const [error, setError] = useState(null);

  // Référence pour détecter les changements de photo
  const lastPhotoIdRef = useRef(null);
  const lastModeRef = useRef(null);

  const loadCurrentPhoto = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/current");
      if (data.hasPhoto && data.photo) {
        // Détecter si la photo a changé (pour animation éventuelle)
        if (data.photo.id !== lastPhotoIdRef.current) {
          lastPhotoIdRef.current = data.photo.id;
        }
        setCurrentPhoto(data.photo);
        setCurrentCategory(data.category);
        return true;
      } else {
        setCurrentPhoto(null);
        return false;
      }
    } catch (e) {
      console.error("[DIAPO] Erreur chargement photo:", e);
      return false;
    }
  }, []);

  const loadAllPhotos = useCallback(async (categoryId) => {
    try {
      const data = await api.get(`/slideshow/all-photos/${categoryId}`);
      setAllPhotos(data.photos || []);
    } catch (e) {
      console.error("[DIAPO] Erreur chargement toutes photos:", e);
    }
  }, []);

  const loadResultsData = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/results-data");
      setResultsData(data);
    } catch (e) {
      console.error("[DIAPO] Erreur chargement résultats:", e);
    }
  }, []);

  // Fonction principale de vérification du statut
  const checkStatus = useCallback(async () => {
    try {
      const statusData = await api.get("/slideshow/status");

      if (statusData.resultsPublished) {
        // Mode résultats publiés
        if (lastModeRef.current !== "results") {
          lastModeRef.current = "results";
          await loadResultsData();
          setMode("results");
        }
        return;
      }

      if (statusData.hasOpenSession) {
        if (statusData.hasCurrentPhoto) {
          // Session ouverte avec une photo en cours → mode notation
          await loadCurrentPhoto();
          if (lastModeRef.current !== "notation") {
            lastModeRef.current = "notation";
          }
          setMode("notation");
        } else {
          // Session ouverte mais pas encore de photo
          setMode("notation_waiting");
          lastModeRef.current = "notation_waiting";
        }
        return;
      }

      if (statusData.hasCompletedSession) {
        // Session terminée → galerie
        if (lastModeRef.current !== "gallery") {
          lastModeRef.current = "gallery";
          if (statusData.completedCategoryId) {
            await loadAllPhotos(statusData.completedCategoryId);
          }
          setMode("gallery");
        }
        return;
      }

      // Aucun état actif
      setMode("waiting");
      lastModeRef.current = "waiting";
      setError(null);
    } catch (e) {
      console.error("[DIAPO] Erreur status:", e);
      setError(e.message);
      setMode("error");
    }
  }, [loadCurrentPhoto, loadAllPhotos, loadResultsData]);

  // Polling toutes les 2 secondes
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // ─── Rendu ───────────────────────────────────────────────────────────────────

  // Chargement initial
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
      <div className="diapo-container diapo-fullscreen">
        <div className="diapo-photo">
          <img
            key={currentPhoto.id}
            src={currentPhoto.url}
            alt={`Photo ${currentPhoto.anonymous_id}`}
            className="diapo-img"
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

  // Session ouverte mais en attente de la première photo
  if (mode === "notation_waiting" || (mode === "notation" && !currentPhoto)) {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="diapo-waiting-content">
          <div className="waiting-icon">📸</div>
          <h1>Session ouverte</h1>
          <p>En attente du chargement de la première photo...</p>
          <div className="spinner spinner-sm" />
        </div>
      </div>
    );
  }

  // Mode galerie - toutes les photos notées
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

  // Erreur
  if (mode === "error") {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="diapo-waiting-content">
          <div className="waiting-icon">⚠️</div>
          <h1>Erreur de connexion</h1>
          <p>{error || "Impossible de charger le diaporama."}</p>
          <button className="btn btn-primary" onClick={checkStatus}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // Attente (aucune session active)
  return (
    <div className="diapo-container diapo-waiting">
      <div className="diapo-waiting-content">
        <div className="waiting-icon">📺</div>
        <h1>Diaporama en attente</h1>
        <p>La session de notation n'a pas encore commencé.</p>
        <p className="small muted">
          Rafraîchissement automatique toutes les 2s
        </p>
      </div>
    </div>
  );
}
