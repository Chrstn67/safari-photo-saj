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

  // Mode résultats contrôlé manuellement
  const [resultsStep, setResultsStep] = useState(0); // 0=favorites, 1=categoryWinners, 2=ranking, 3=scores, 4=eyePrize
  const [currentRevealIndex, setCurrentRevealIndex] = useState(0);
  const [rankingRevealIndex, setRankingRevealIndex] = useState(0);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [showControls, setShowControls] = useState(false); // Ctrl+Shift+D pour afficher/masquer

  // Référence pour détecter les changements de photo
  const lastPhotoIdRef = useRef(null);
  const lastModeRef = useRef(null);

  // Raccourci clavier pour afficher les contrôles
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Shift+D pour afficher/masquer les contrôles
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        setShowControls((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const loadCurrentPhoto = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/current");
      if (data.hasPhoto && data.photo) {
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
      setResultsStep(0);
      setCurrentRevealIndex(0);
      setRankingRevealIndex(0);
      setScoresRevealed(false);
    } catch (e) {
      console.error("[DIAPO] Erreur chargement résultats:", e);
    }
  }, []);

  // Navigation manuelle dans les résultats
  const nextResultStep = () => {
    if (!resultsData) return;

    if (resultsStep === 0) {
      // Coups de cœur - révéler progressivement
      const favorites = resultsData.favoriteCounts || [];
      if (currentRevealIndex < favorites.length - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(1);
        setCurrentRevealIndex(0);
      }
    } else if (resultsStep === 1) {
      // Prix par catégorie - révéler progressivement
      const winners = resultsData.categoryWinners || [];
      if (currentRevealIndex < winners.length - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(2);
        setCurrentRevealIndex(0);
      }
    } else if (resultsStep === 2) {
      // Classement - révéler de la fin vers le début
      const ranking = resultsData.generalRanking || [];
      if (rankingRevealIndex < ranking.length - 1) {
        setRankingRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(3);
      }
    } else if (resultsStep === 3) {
      // Révéler les scores
      setScoresRevealed(true);
      setResultsStep(4);
    } else if (resultsStep === 4) {
      // Prix de l'œil
      setResultsStep(5);
    }
  };

  const prevResultStep = () => {
    if (resultsStep === 1 && currentRevealIndex > 0) {
      setCurrentRevealIndex((prev) => prev - 1);
    } else if (resultsStep === 1 && currentRevealIndex === 0) {
      setResultsStep(0);
      const favorites = resultsData?.favoriteCounts || [];
      setCurrentRevealIndex(favorites.length - 1);
    } else if (resultsStep === 2 && rankingRevealIndex > 0) {
      setRankingRevealIndex((prev) => prev - 1);
    } else if (resultsStep === 2 && rankingRevealIndex === 0) {
      setResultsStep(1);
      const winners = resultsData?.categoryWinners || [];
      setCurrentRevealIndex(winners.length - 1);
    } else if (resultsStep === 3) {
      setResultsStep(2);
      const ranking = resultsData?.generalRanking || [];
      setRankingRevealIndex(ranking.length - 1);
    } else if (resultsStep === 4) {
      setResultsStep(3);
      setScoresRevealed(false);
    } else if (resultsStep === 5) {
      setResultsStep(4);
    }
  };

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
          await loadCurrentPhoto();
          if (lastModeRef.current !== "notation") {
            lastModeRef.current = "notation";
          }
          setMode("notation");
        } else {
          setMode("notation_waiting");
          lastModeRef.current = "notation_waiting";
        }
        return;
      }

      if (statusData.hasCompletedSession) {
        if (lastModeRef.current !== "gallery") {
          lastModeRef.current = "gallery";
          if (statusData.completedCategoryId) {
            await loadAllPhotos(statusData.completedCategoryId);
          }
          setMode("gallery");
        }
        return;
      }

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

        {/* Bouton déconnexion toujours accessible */}
        <button className="diapo-logout" onClick={logout}>
          🔓 Déconnexion
        </button>
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
        <button className="diapo-logout" onClick={logout}>
          🔓 Déconnexion
        </button>
      </div>
    );
  }

  // Mode galerie - toutes les photos notées (UNIQUEMENT LES PHOTOS, PAS DE NOMS)
  if (mode === "gallery" && allPhotos.length > 0) {
    return (
      <div className="diapo-container diapo-gallery">
        <div className="diapo-gallery-header">
          <h1 className="diapo-title">📸 Toutes les photos notées</h1>
          <button className="diapo-logout" onClick={logout}>
            🔓 Déconnexion
          </button>
        </div>
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

  // Mode résultats avec contrôle manuel
  if (mode === "results" && resultsData?.published) {
    const favorites = resultsData.favoriteCounts || [];
    const categoryWinners = resultsData.categoryWinners || [];
    const ranking = resultsData.generalRanking || [];

    // Révéler le classement depuis la fin
    const revealedRanking = ranking.slice(
      ranking.length - 1 - rankingRevealIndex,
    );
    // Les deux derniers sont révélés ensemble quand il ne reste que 2 à départager
    const isLastTwo = rankingRevealIndex >= ranking.length - 2;

    return (
      <div className="diapo-container diapo-results">
        {/* Étape 0: Coups de cœur */}
        {resultsStep === 0 && (
          <div className="results-step">
            <h1 className="results-title">❤️ COUPS DE CŒUR DU JURY ❤️</h1>
            <div className="results-favorites">
              {favorites.slice(0, currentRevealIndex + 1).map((fav, idx) => (
                <div
                  key={fav.submissionId || idx}
                  className="favorite-card fade-in"
                >
                  {fav.photoUrl && <img src={fav.photoUrl} alt="" />}
                  <div className="favorite-count">{fav.count} ❤️</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Étape 1: Prix par catégorie */}
        {resultsStep === 1 && (
          <div className="results-step">
            <h1 className="results-title">🏆 PRIX PAR CATÉGORIE 🏆</h1>
            <div className="results-categories">
              {categoryWinners
                .slice(0, currentRevealIndex + 1)
                .map((winner, idx) => (
                  <div
                    key={winner.categoryId || idx}
                    className="category-card fade-in"
                  >
                    <div className="category-name">{winner.categoryName}</div>
                    {winner.url && <img src={winner.url} alt="" />}
                    <div className="winner-id">{winner.anonymousId}</div>
                    <div className="winner-score">
                      {winner.averageScore?.toFixed(1)}/20
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Étape 2: Classement (sans scores) */}
        {resultsStep === 2 && (
          <div className="results-step">
            <h1 className="results-title">📊 CLASSEMENT GÉNÉRAL 📊</h1>
            <div className="results-ranking">
              {revealedRanking
                .slice()
                .reverse()
                .map((item, idx) => {
                  const isTop3 =
                    item.rank === 1 || item.rank === 2 || item.rank === 3;
                  const isRevealedLastTwo =
                    isLastTwo && idx >= revealedRanking.length - 2;

                  return (
                    <div
                      key={item.anonymousId}
                      className={`ranking-card ${isTop3 ? `rank-${item.rank}` : ""} fade-in`}
                      style={{ animationDelay: `${idx * 0.1}s` }}
                    >
                      <div className="ranking-position">
                        {item.rank === 1 && "🥇"}
                        {item.rank === 2 && "🥈"}
                        {item.rank === 3 && "🥉"}
                        {item.rank > 3 && `${item.rank}e`}
                      </div>
                      <div className="ranking-name">{item.anonymousId}</div>
                      {!scoresRevealed && !isRevealedLastTwo && (
                        <div className="ranking-placeholder">??? pts</div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Étape 3: Scores révélés */}
        {resultsStep === 3 && (
          <div className="results-step">
            <h1 className="results-title">📊 CLASSEMENT GÉNÉRAL 📊</h1>
            <div className="results-ranking with-scores">
              {ranking.map((item, idx) => (
                <div
                  key={item.anonymousId}
                  className={`ranking-card ${item.rank === 1 ? "rank-1" : item.rank === 2 ? "rank-2" : item.rank === 3 ? "rank-3" : ""} fade-in`}
                >
                  <div className="ranking-position">
                    {item.rank === 1 && "🥇"}
                    {item.rank === 2 && "🥈"}
                    {item.rank === 3 && "🥉"}
                    {item.rank > 3 && `${item.rank}e`}
                  </div>
                  <div className="ranking-name">{item.anonymousId}</div>
                  <div className="ranking-score">
                    {item.total?.toFixed(1)} pts
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Étape 4: Prix de l'œil */}
        {resultsStep === 4 && resultsData.eyePrize && (
          <div className="results-step">
            <h1 className="results-title">👁️ PRIX DE L'ŒIL 👁️</h1>
            <div className="results-eyeprize">
              <div className="eyeprize-card fade-in">
                {resultsData.eyePrize.url && (
                  <img src={resultsData.eyePrize.url} alt="" />
                )}
                <div className="eyeprize-id">
                  {resultsData.eyePrize.anonymousId}
                </div>
                <div className="eyeprize-category">
                  {resultsData.eyePrize.categoryName}
                </div>
                <div className="eyeprize-badge">
                  ✨ Photo la plus originale ✨
                </div>
              </div>
            </div>
            <div className="eyeprize-announce">
              <p>Le jury va maintenant donner son avis oralement...</p>
            </div>
          </div>
        )}

        {/* Étape 5: Fin */}
        {resultsStep === 5 && (
          <div className="results-step">
            <div className="results-end">
              <div className="end-icon">🏆</div>
              <h1 className="results-title">FIN DE LA CÉRÉMONIE</h1>
              <p>Merci à tous les participants !</p>
            </div>
          </div>
        )}

        {/* Contrôles (visibles uniquement avec Ctrl+Shift+D) */}
        {showControls && (
          <div className="diapo-results-controls">
            <button onClick={prevResultStep} className="control-btn">
              ◀ Précédent
            </button>
            <button onClick={nextResultStep} className="control-btn">
              {resultsStep === 5 ? "Terminer" : "Suivant ▶"}
            </button>
            <button
              onClick={() => setShowControls(false)}
              className="control-btn"
            >
              ✕ Masquer
            </button>
          </div>
        )}

        {/* Bouton déconnexion toujours visible */}
        <button className="diapo-logout" onClick={logout}>
          🔓 Déconnexion
        </button>

        {/* Indicateur de contrôles */}
        <div className="diapo-controls-hint">
          Ctrl+Shift+D pour afficher les contrôles
        </div>
      </div>
    );
  }

  // Mode résultats mais pas encore de données
  if (mode === "results" && !resultsData?.published) {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="diapo-waiting-content">
          <div className="waiting-icon">🏆</div>
          <h1>Préparation des résultats</h1>
          <p>Les résultats seront bientôt disponibles...</p>
        </div>
        <button className="diapo-logout" onClick={logout}>
          🔓 Déconnexion
        </button>
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
        <button className="diapo-logout" onClick={logout}>
          🔓 Déconnexion
        </button>
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
      <button className="diapo-logout" onClick={logout}>
        🔓 Déconnexion
      </button>
    </div>
  );
}
