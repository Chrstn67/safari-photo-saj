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
  const [completedCategoryId, setCompletedCategoryId] = useState(null);

  // État du processus d'élimination
  const [ceremonyStep, setCeremonyStep] = useState(0);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [revealedRanking, setRevealedRanking] = useState([]);
  const [rankingRevealedCount, setRankingRevealedCount] = useState(0);
  const [showScores, setShowScores] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // Références
  const lastPhotoIdRef = useRef(null);
  const intervalRef = useRef(null);

  // Raccourci clavier
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "H") {
        setShowControls((prev) => !prev);
      }
      if (e.key === "ArrowRight" && showControls && mode === "results") {
        nextCeremonyStep();
      }
      if (e.key === "ArrowLeft" && showControls && mode === "results") {
        prevCeremonyStep();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    showControls,
    ceremonyStep,
    currentPhotoIndex,
    currentCategoryIndex,
    rankingRevealedCount,
    mode,
  ]);

  // Charger la photo en cours pour la notation
  const loadCurrentPhoto = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/current");
      console.log("[DIAPO] Current photo:", data);
      if (data.hasPhoto && data.photo && data.photo.url) {
        if (data.photo.id !== lastPhotoIdRef.current) {
          lastPhotoIdRef.current = data.photo.id;
          setCurrentPhoto(data.photo);
          setCurrentCategory(data.category);
          return true;
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error("[DIAPO] Erreur:", e);
      return false;
    }
  }, []);

  // Charger toutes les photos d'une catégorie (GALERIE)
  const loadAllPhotos = useCallback(async (categoryId) => {
    try {
      console.log("[DIAPO] Loading gallery for category:", categoryId);
      const data = await api.get(`/slideshow/all-photos/${categoryId}`);
      console.log("[DIAPO] Gallery photos count:", data.photos?.length);
      setAllPhotos(data.photos || []);
      return data.photos || [];
    } catch (e) {
      console.error("[DIAPO] Erreur galerie:", e);
      return [];
    }
  }, []);

  // Charger les données des résultats
  const loadResultsData = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/results-data");
      console.log("[DIAPO] Results data:", data);
      setResultsData(data);
      // Réinitialiser le processus
      setCeremonyStep(0);
      setCurrentPhotoIndex(0);
      setCurrentCategoryIndex(0);
      setRevealedRanking([]);
      setRankingRevealedCount(0);
      setShowScores(false);
      return data;
    } catch (e) {
      console.error("[DIAPO] Erreur résultats:", e);
      return null;
    }
  }, []);

  // Navigation dans le processus d'élimination
  const nextCeremonyStep = () => {
    if (!resultsData) return;

    if (ceremonyStep === 0) {
      setCeremonyStep(1);
      setCurrentPhotoIndex(0);
      return;
    }

    if (ceremonyStep === 1) {
      const favorites = resultsData.favoriteCounts || [];
      if (currentPhotoIndex < favorites.length - 1) {
        setCurrentPhotoIndex((prev) => prev + 1);
      } else {
        setCeremonyStep(2);
        setCurrentCategoryIndex(0);
      }
      return;
    }

    if (ceremonyStep === 2) {
      const winners = resultsData.categoryWinners || [];
      if (currentCategoryIndex < winners.length - 1) {
        setCurrentCategoryIndex((prev) => prev + 1);
      } else {
        setCeremonyStep(3);
        setRankingRevealedCount(0);
        setRevealedRanking([]);
      }
      return;
    }

    if (ceremonyStep === 3) {
      const ranking = resultsData.generalRanking || [];
      const totalToReveal = ranking.length;

      if (rankingRevealedCount < totalToReveal) {
        const newCount = rankingRevealedCount + 1;
        setRankingRevealedCount(newCount);
        const revealed = ranking.slice(ranking.length - newCount);
        setRevealedRanking(revealed);
      } else {
        setCeremonyStep(4);
      }
      return;
    }

    if (ceremonyStep === 4) {
      setShowScores(true);
      setCeremonyStep(5);
      return;
    }

    if (ceremonyStep === 5) {
      setCeremonyStep(6);
      return;
    }
  };

  const prevCeremonyStep = () => {
    if (!resultsData) return;

    if (ceremonyStep === 1 && currentPhotoIndex > 0) {
      setCurrentPhotoIndex((prev) => prev - 1);
    } else if (ceremonyStep === 1 && currentPhotoIndex === 0) {
      setCeremonyStep(0);
    } else if (ceremonyStep === 2 && currentCategoryIndex > 0) {
      setCurrentCategoryIndex((prev) => prev - 1);
    } else if (ceremonyStep === 2 && currentCategoryIndex === 0) {
      setCeremonyStep(1);
      const favorites = resultsData?.favoriteCounts || [];
      setCurrentPhotoIndex(favorites.length - 1);
    } else if (ceremonyStep === 3 && rankingRevealedCount > 0) {
      setRankingRevealedCount((prev) => prev - 1);
      const ranking = resultsData?.generalRanking || [];
      const newCount = rankingRevealedCount - 1;
      const revealed = ranking.slice(ranking.length - newCount);
      setRevealedRanking(revealed);
    } else if (ceremonyStep === 3 && rankingRevealedCount === 0) {
      setCeremonyStep(2);
      const winners = resultsData?.categoryWinners || [];
      setCurrentCategoryIndex(winners.length - 1);
    } else if (ceremonyStep === 4) {
      setCeremonyStep(3);
      setShowScores(false);
      const ranking = resultsData?.generalRanking || [];
      setRankingRevealedCount(ranking.length);
      setRevealedRanking(ranking);
    } else if (ceremonyStep === 5) {
      setCeremonyStep(4);
      setShowScores(true);
    } else if (ceremonyStep === 6) {
      setCeremonyStep(5);
    }
  };

  // Vérification du statut - CORRIGÉE
  const checkStatus = useCallback(async () => {
    try {
      console.log("[DIAPO] Checking status...");
      const statusData = await api.get("/slideshow/status");
      console.log("[DIAPO] Status received:", statusData);

      // 1. Vérifier les résultats publiés
      if (statusData.resultsPublished === true && mode !== "results") {
        console.log("[DIAPO] Results published, loading...");
        await loadResultsData();
        setMode("results");
        return;
      }

      // 2. Vérifier la session de notation
      if (
        statusData.hasOpenSession === true &&
        statusData.hasCurrentPhoto === true
      ) {
        const hasPhoto = await loadCurrentPhoto();
        if (hasPhoto && currentPhoto && mode !== "notation") {
          console.log("[DIAPO] Switching to notation mode");
          setMode("notation");
        }
        return;
      }

      // 3. Vérifier la session ouverte mais sans photo
      if (
        statusData.hasOpenSession === true &&
        statusData.hasCurrentPhoto === false
      ) {
        if (mode !== "notation_waiting") {
          console.log("[DIAPO] Waiting for first photo");
          setMode("notation_waiting");
        }
        return;
      }

      // 4. Vérifier la session terminée (GALERIE)
      if (
        statusData.hasCompletedSession === true &&
        statusData.completedCategoryId
      ) {
        if (mode !== "gallery") {
          console.log(
            "[DIAPO] Session completed, loading gallery for category:",
            statusData.completedCategoryId,
          );
          setCompletedCategoryId(statusData.completedCategoryId);
          const photos = await loadAllPhotos(statusData.completedCategoryId);
          if (photos && photos.length > 0) {
            setMode("gallery");
          } else {
            setMode("waiting");
          }
        }
        return;
      }

      // 5. Sinon, mode attente
      if (mode !== "waiting" && mode !== "loading" && mode !== "results") {
        console.log("[DIAPO] Waiting mode");
        setMode("waiting");
      }
    } catch (e) {
      console.error("[DIAPO] Error:", e);
      setError(e.message);
      setMode("error");
    }
  }, [loadCurrentPhoto, loadAllPhotos, loadResultsData, mode, currentPhoto]);

  // Polling toutes les 2 secondes
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const LogoutButton = () => (
    <button className="diapo-logout" onClick={logout}>
      🔓 Déconnexion
    </button>
  );

  const NavigationControls = () => {
    if (!showControls || mode !== "results") return null;

    let nextLabel = "Suivant ▶";
    if (ceremonyStep === 0) nextLabel = "Commencer ▶";
    if (ceremonyStep === 5) nextLabel = "Prix de l'œil ▶";
    if (ceremonyStep === 6) nextLabel = "Terminer";

    return (
      <div className="diapo-nav-controls">
        <button className="nav-btn prev-btn" onClick={prevCeremonyStep}>
          ◀ Précédent
        </button>
        <button className="nav-btn next-btn" onClick={nextCeremonyStep}>
          {nextLabel}
        </button>
        <button
          className="nav-btn hide-btn"
          onClick={() => setShowControls(false)}
        >
          🙈 Masquer
        </button>
      </div>
    );
  };

  // ==================== RENDU ====================

  // Mode Notation - photo en cours
  if (mode === "notation" && currentPhoto && currentPhoto.url) {
    return (
      <div className="diapo-container diapo-notation">
        <div className="diapo-photo-wrapper">
          <img src={currentPhoto.url} alt="" className="diapo-photo" />
        </div>
        {currentCategory && (
          <div className="diapo-category">{currentCategory}</div>
        )}
        <div className="diapo-anonymous-id">{currentPhoto.anonymous_id}</div>
        <div className="diapo-status-badge">📸 Notation en cours...</div>
        <LogoutButton />
      </div>
    );
  }

  // Mode Notation - en attente de photo
  if (mode === "notation_waiting") {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="waiting-content">
          <div className="waiting-icon">📸</div>
          <h1>Session de notation ouverte</h1>
          <p>En attente de la première photo...</p>
          <div className="spinner spinner-sm" />
        </div>
        <LogoutButton />
      </div>
    );
  }

  // Mode Galerie - TOUTES LES PHOTOS (seulement les photos)
  if (mode === "gallery" && allPhotos.length > 0) {
    return (
      <div className="diapo-container diapo-gallery">
        <div className="gallery-header">
          <h1 className="gallery-title">📸 Toutes les photos notées</h1>
          <LogoutButton />
        </div>
        <div className="gallery-grid">
          {allPhotos.map((photo, idx) => (
            <div key={photo.id} className="gallery-item">
              <img src={photo.url} alt="" />
            </div>
          ))}
        </div>
        <div className="gallery-footer">
          <div className="diapo-status-badge">🎬 Fin de la notation</div>
          <button
            className="next-results-btn"
            onClick={async () => {
              console.log("[DIAPO] Going to results ceremony");
              await loadResultsData();
              setMode("results");
            }}
          >
            🏆 Voir les résultats ▶
          </button>
        </div>
      </div>
    );
  }

  // Mode Résultats - Processus d'élimination
  if (mode === "results" && resultsData) {
    const favorites = resultsData.favoriteCounts || [];
    const categoryWinners = resultsData.categoryWinners || [];
    const ranking = resultsData.generalRanking || [];
    const currentFavorite = favorites[currentPhotoIndex];
    const currentWinner = categoryWinners[currentCategoryIndex];
    const showLastTwoTogether =
      rankingRevealedCount === ranking.length - 1 && ranking.length > 2;

    return (
      <div className="diapo-container diapo-ceremony">
        {/* ÉCRAN 0: PRÊT */}
        {ceremonyStep === 0 && (
          <div className="ceremony-screen">
            <h1 className="ceremony-title">🏆 CÉRÉMONIE DES RÉSULTATS 🏆</h1>
            <div className="ceremony-start">
              <div className="start-icon">🎬</div>
              <p>Appuyez sur "Commencer" pour démarrer la cérémonie</p>
            </div>
          </div>
        )}

        {/* ÉCRAN 1: COUPS DE CŒUR */}
        {ceremonyStep === 1 && currentFavorite && (
          <div className="ceremony-screen">
            <h1 className="ceremony-title">❤️ COUPS DE CŒUR DU JURY ❤️</h1>
            <div className="ceremony-photo">
              <img src={currentFavorite.photoUrl} alt="" />
              <div className="ceremony-hearts">
                {"❤️".repeat(Math.min(currentFavorite.count, 5))}
              </div>
            </div>
            <div className="ceremony-counter">
              {currentPhotoIndex + 1} / {favorites.length}
            </div>
          </div>
        )}

        {/* ÉCRAN 2: PRIX PAR CATÉGORIE */}
        {ceremonyStep === 2 && currentWinner && (
          <div className="ceremony-screen">
            <h1 className="ceremony-title">🏆 PRIX PAR CATÉGORIE 🏆</h1>
            <div className="ceremony-category-name">
              {currentWinner.categoryName}
            </div>
            <div className="ceremony-photo">
              <img src={currentWinner.url} alt="" />
            </div>
            <div className="ceremony-winner-id">
              {currentWinner.anonymousId}
            </div>
            <div className="ceremony-counter">
              {currentCategoryIndex + 1} / {categoryWinners.length}
            </div>
          </div>
        )}

        {/* ÉCRAN 3: CLASSEMENT SANS SCORES (ÉLIMINATION) */}
        {ceremonyStep === 3 && (
          <div className="ceremony-screen ceremony-ranking">
            <h1 className="ceremony-title">📊 CLASSEMENT GÉNÉRAL 📊</h1>
            <div className="ranking-elimination">
              {revealedRanking
                .slice()
                .reverse()
                .map((item, idx) => {
                  const actualRank =
                    ranking.length - revealedRanking.length + idx + 1;
                  const isLastTwo =
                    showLastTwoTogether &&
                    (actualRank === 1 || actualRank === 2);

                  return (
                    <div
                      key={item.anonymousId}
                      className={`ranking-elimination-item ${actualRank === 1 ? "rank-1" : actualRank === 2 ? "rank-2" : actualRank === 3 ? "rank-3" : ""}`}
                    >
                      <div className="rank-number">
                        {actualRank === 1 && "🥇"}
                        {actualRank === 2 && "🥈"}
                        {actualRank === 3 && "🥉"}
                        {actualRank > 3 && `${actualRank}e`}
                      </div>
                      <div className="rank-name">{item.anonymousId}</div>
                      {!isLastTwo && (
                        <div className="rank-placeholder">??? pts</div>
                      )}
                    </div>
                  );
                })}
            </div>
            {showLastTwoTogether && (
              <div className="ceremony-announce">
                ✨ Les deux finalistes sont dévoilés ! ✨
              </div>
            )}
          </div>
        )}

        {/* ÉCRAN 4: CLASSEMENT AVEC SCORES */}
        {ceremonyStep === 4 && (
          <div className="ceremony-screen ceremony-ranking">
            <h1 className="ceremony-title">📊 CLASSEMENT GÉNÉRAL 📊</h1>
            <div className="ranking-with-scores">
              {ranking.map((item, idx) => (
                <div
                  key={item.anonymousId}
                  className={`ranking-score-item ${idx === 0 ? "rank-1" : idx === 1 ? "rank-2" : idx === 2 ? "rank-3" : ""}`}
                >
                  <div className="rank-number">
                    {idx === 0 && "🥇"}
                    {idx === 1 && "🥈"}
                    {idx === 2 && "🥉"}
                    {idx > 2 && `${idx + 1}e`}
                  </div>
                  <div className="rank-name">{item.anonymousId}</div>
                  <div className="rank-score">{item.total?.toFixed(1)} pts</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ÉCRAN 5: PRIX DE L'ŒIL */}
        {ceremonyStep === 5 && (
          <div className="ceremony-screen">
            <h1 className="ceremony-title">👁️ PRIX DE L'ŒIL 👁️</h1>
            {resultsData.eyePrize && resultsData.eyePrize.url ? (
              <div className="ceremony-eyeprize">
                <div className="ceremony-photo">
                  <img src={resultsData.eyePrize.url} alt="" />
                </div>
                <div className="ceremony-winner-id">
                  {resultsData.eyePrize.anonymousId}
                </div>
                <div className="ceremony-category-name">
                  {resultsData.eyePrize.categoryName}
                </div>
                <div className="eyeprize-badge">
                  ✨ Photo la plus originale ✨
                </div>
              </div>
            ) : (
              <div className="ceremony-placeholder">
                <div className="placeholder-icon">👁️</div>
                <p>Le jury délibère...</p>
              </div>
            )}
            <div className="ceremony-oral-announce">
              <p>🎤 Le jury va maintenant donner son avis oralement...</p>
            </div>
          </div>
        )}

        {/* ÉCRAN 6: FIN */}
        {ceremonyStep === 6 && (
          <div className="ceremony-screen ceremony-end">
            <div className="end-icon">🏆</div>
            <h1 className="ceremony-title">FIN DE LA CÉRÉMONIE</h1>
            <p className="end-message">Merci à tous les participants !</p>
          </div>
        )}

        <div className="ceremony-step-indicator">
          {ceremonyStep === 0 && <span>⏸️ Prêt</span>}
          {ceremonyStep === 1 && (
            <span>
              ❤️ Coups de cœur ({currentPhotoIndex + 1}/{favorites.length})
            </span>
          )}
          {ceremonyStep === 2 && (
            <span>
              🏆 Prix ({currentCategoryIndex + 1}/{categoryWinners.length})
            </span>
          )}
          {ceremonyStep === 3 && (
            <span>
              📊 Classement ({rankingRevealedCount}/{ranking.length})
            </span>
          )}
          {ceremonyStep === 4 && <span>📊 Scores</span>}
          {ceremonyStep === 5 && <span>👁️ Prix de l'œil</span>}
          {ceremonyStep === 6 && <span>🏁 Fin</span>}
        </div>

        <NavigationControls />
        <LogoutButton />

        {!showControls && (
          <button
            className="show-controls-btn"
            onClick={() => setShowControls(true)}
          >
            🎮 Afficher contrôles
          </button>
        )}
      </div>
    );
  }

  // Chargement
  if (mode === "loading") {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="waiting-content">
          <div className="spinner spinner-lg" />
          <p>Chargement du diaporama...</p>
        </div>
      </div>
    );
  }

  // Erreur
  if (mode === "error") {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="waiting-content">
          <div className="waiting-icon">⚠️</div>
          <h1>Erreur de connexion</h1>
          <p>{error || "Impossible de charger le diaporama."}</p>
          <button
            className="retry-btn"
            onClick={() => window.location.reload()}
          >
            🔄 Réessayer
          </button>
        </div>
        <LogoutButton />
      </div>
    );
  }

  // Attente par défaut
  return (
    <div className="diapo-container diapo-waiting">
      <div className="waiting-content">
        <div className="waiting-icon">📺</div>
        <h1>Diaporama en attente</h1>
        <p>La session n'a pas encore commencé.</p>
        <p className="waiting-note">Actualisation automatique...</p>
      </div>
      <LogoutButton />
    </div>
  );
}
