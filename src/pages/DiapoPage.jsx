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

  // Contrôles visibles par défaut en mode résultats
  const [showControls, setShowControls] = useState(true);

  // Références
  const lastPhotoIdRef = useRef(null);
  const lastModeRef = useRef(null);

  // Raccourci clavier pour masquer/afficher les contrôles (optionnel)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "H") {
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
      // Réinitialiser l'état des résultats
      setResultsStep(0);
      setCurrentRevealIndex(0);
      setRankingRevealIndex(0);
      setScoresRevealed(false);
      setShowControls(true);
    } catch (e) {
      console.error("[DIAPO] Erreur chargement résultats:", e);
    }
  }, []);

  // Navigation manuelle dans les résultats
  const nextStep = () => {
    if (!resultsData) return;

    // Étape 0: Coups de cœur
    if (resultsStep === 0) {
      const favorites = resultsData.favoriteCounts || [];
      if (currentRevealIndex < favorites.length - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(1);
        setCurrentRevealIndex(0);
      }
    }
    // Étape 1: Prix par catégorie
    else if (resultsStep === 1) {
      const winners = resultsData.categoryWinners || [];
      if (currentRevealIndex < winners.length - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(2);
        setCurrentRevealIndex(0);
      }
    }
    // Étape 2: Classement sans scores (de la fin vers le début)
    else if (resultsStep === 2) {
      const ranking = resultsData.generalRanking || [];
      if (rankingRevealIndex < ranking.length - 1) {
        setRankingRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(3);
      }
    }
    // Étape 3: Révéler les scores
    else if (resultsStep === 3) {
      setScoresRevealed(true);
      setResultsStep(4);
    }
    // Étape 4: Prix de l'œil
    else if (resultsStep === 4) {
      setResultsStep(5);
    }
    // Étape 5: Fin - on reste
  };

  const prevStep = () => {
    // Étape 1: revenir aux coups de cœur
    if (resultsStep === 1 && currentRevealIndex > 0) {
      setCurrentRevealIndex((prev) => prev - 1);
    } else if (resultsStep === 1 && currentRevealIndex === 0) {
      setResultsStep(0);
      const favorites = resultsData?.favoriteCounts || [];
      setCurrentRevealIndex(favorites.length - 1);
    }
    // Étape 2: revenir aux prix par catégorie
    else if (resultsStep === 2 && rankingRevealIndex > 0) {
      setRankingRevealIndex((prev) => prev - 1);
    } else if (resultsStep === 2 && rankingRevealIndex === 0) {
      setResultsStep(1);
      const winners = resultsData?.categoryWinners || [];
      setCurrentRevealIndex(winners.length - 1);
    }
    // Étape 3: revenir au classement sans scores
    else if (resultsStep === 3) {
      setResultsStep(2);
      const ranking = resultsData?.generalRanking || [];
      setRankingRevealIndex(ranking.length - 1);
    }
    // Étape 4: revenir aux scores
    else if (resultsStep === 4) {
      setResultsStep(3);
      setScoresRevealed(false);
    }
    // Étape 5: revenir au prix de l'œil
    else if (resultsStep === 5) {
      setResultsStep(4);
    }
  };

  // Fonction principale de vérification du statut
  const checkStatus = useCallback(async () => {
    try {
      const statusData = await api.get("/slideshow/status");

      if (statusData.resultsPublished) {
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

  // Rendu du bouton déconnexion
  const LogoutButton = () => (
    <button className="diapo-logout" onClick={logout}>
      🔓 Déconnexion
    </button>
  );

  // Rendu des contrôles de navigation
  const NavigationControls = () => {
    if (!showControls) return null;

    let nextLabel = "Suivant ▶";
    if (resultsStep === 4) nextLabel = "Prix de l'œil ▶";
    if (resultsStep === 5) nextLabel = "Terminer";

    return (
      <div className="diapo-nav-controls">
        <button className="nav-btn prev-btn" onClick={prevStep}>
          ◀ Précédent
        </button>
        <button className="nav-btn next-btn" onClick={nextStep}>
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

  // Chargement initial
  if (mode === "loading") {
    return (
      <div className="diapo-loading">
        <div className="spinner spinner-lg" />
        <p>Chargement du diaporama...</p>
        <LogoutButton />
      </div>
    );
  }

  // Mode notation - photo en cours
  if (mode === "notation" && currentPhoto?.url) {
    return (
      <div className="diapo-container diapo-notation">
        <div className="diapo-photo-wrapper">
          <img
            key={currentPhoto.id}
            src={currentPhoto.url}
            alt=""
            className="diapo-photo"
          />
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

  // Session ouverte mais en attente
  if (mode === "notation_waiting" || (mode === "notation" && !currentPhoto)) {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="waiting-content">
          <div className="waiting-icon">📸</div>
          <h1>Session ouverte</h1>
          <p>En attente de la première photo...</p>
          <div className="spinner spinner-sm" />
        </div>
        <LogoutButton />
      </div>
    );
  }

  // Mode galerie - TOUTES LES PHOTOS (UNIQUEMENT LES PHOTOS, PAS DE NOMS)
  if (mode === "gallery" && allPhotos.length > 0) {
    return (
      <div className="diapo-container diapo-gallery">
        <div className="gallery-header">
          <h1 className="gallery-title">📸 Toutes les photos notées</h1>
          <LogoutButton />
        </div>
        <div className="gallery-grid">
          {allPhotos.map((photo, index) => (
            <div key={photo.id} className="gallery-item">
              <img src={photo.url} alt={`Photo ${index + 1}`} />
            </div>
          ))}
        </div>
        <div className="diapo-status-badge">🎬 Fin de la notation</div>
      </div>
    );
  }

  // MODE RÉSULTATS - avec contrôle manuel complet
  if (mode === "results" && resultsData?.published) {
    const favorites = resultsData.favoriteCounts || [];
    const categoryWinners = resultsData.categoryWinners || [];
    const ranking = resultsData.generalRanking || [];

    // Révélation du classement depuis la fin
    // Quand il ne reste plus que 2 candidats, ils sont révélés ensemble
    const revealedCount = rankingRevealIndex + 1;
    const isLastTwoRevealed = revealedCount >= ranking.length - 1;
    const revealedRanking = ranking.slice(ranking.length - revealedCount);

    return (
      <div className="diapo-container diapo-results">
        {/* ÉTAPE 0: COUPS DE CŒUR */}
        {resultsStep === 0 && (
          <div className="results-step">
            <h1 className="results-title">❤️ COUPS DE CŒUR DU JURY ❤️</h1>
            <div className="favorites-grid">
              {favorites.slice(0, currentRevealIndex + 1).map((fav, idx) => (
                <div key={fav.submissionId || idx} className="favorite-card">
                  {fav.photoUrl && <img src={fav.photoUrl} alt="" />}
                  <div className="favorite-hearts">
                    {"❤️".repeat(Math.min(fav.count, 5))}
                  </div>
                  <div className="favorite-count">
                    {fav.count} coup(s) de cœur
                  </div>
                </div>
              ))}
            </div>
            {(!favorites.length ||
              currentRevealIndex === favorites.length - 1) && (
              <div className="step-hint">
                ✨ Tous les coups de cœur dévoilés ✨
              </div>
            )}
          </div>
        )}

        {/* ÉTAPE 1: PRIX PAR CATÉGORIE */}
        {resultsStep === 1 && (
          <div className="results-step">
            <h1 className="results-title">🏆 PRIX PAR CATÉGORIE 🏆</h1>
            <div className="winners-grid">
              {categoryWinners
                .slice(0, currentRevealIndex + 1)
                .map((winner, idx) => (
                  <div key={winner.categoryId || idx} className="winner-card">
                    <div className="winner-category">{winner.categoryName}</div>
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

        {/* ÉTAPE 2: CLASSEMENT SANS SCORES (de la fin vers le début) */}
        {resultsStep === 2 && (
          <div className="results-step">
            <h1 className="results-title">📊 CLASSEMENT GÉNÉRAL 📊</h1>
            <div className="ranking-list">
              {revealedRanking
                .slice()
                .reverse()
                .map((item, idx) => {
                  const actualRank =
                    ranking.length - (rankingRevealIndex + 1) + idx + 1;
                  const isTop3 =
                    actualRank === 1 || actualRank === 2 || actualRank === 3;
                  // Quand il ne reste que 2 candidats, on les révèle ensemble
                  const showScore = isLastTwoRevealed && actualRank <= 2;

                  return (
                    <div
                      key={item.anonymousId}
                      className={`ranking-item ${isTop3 ? `rank-${actualRank}` : ""}`}
                      style={{ animationDelay: `${idx * 0.1}s` }}
                    >
                      <div className="ranking-position">
                        {actualRank === 1 && "🥇"}
                        {actualRank === 2 && "🥈"}
                        {actualRank === 3 && "🥉"}
                        {actualRank > 3 && `${actualRank}e`}
                      </div>
                      <div className="ranking-name">{item.anonymousId}</div>
                      {!showScore && !isLastTwoRevealed && (
                        <div className="ranking-placeholder">??? pts</div>
                      )}
                    </div>
                  );
                })}
            </div>
            {isLastTwoRevealed && (
              <div className="step-hint">
                🎯 Les deux finalistes sont dévoilés !
              </div>
            )}
          </div>
        )}

        {/* ÉTAPE 3: CLASSEMENT AVEC SCORES */}
        {resultsStep === 3 && (
          <div className="results-step">
            <h1 className="results-title">📊 CLASSEMENT GÉNÉRAL 📊</h1>
            <div className="ranking-list with-scores">
              {ranking.map((item, idx) => (
                <div
                  key={item.anonymousId}
                  className={`ranking-item ${idx === 0 ? "rank-1" : idx === 1 ? "rank-2" : idx === 2 ? "rank-3" : ""}`}
                >
                  <div className="ranking-position">
                    {idx === 0 && "🥇"}
                    {idx === 1 && "🥈"}
                    {idx === 2 && "🥉"}
                    {idx > 2 && `${idx + 1}e`}
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

        {/* ÉTAPE 4: PRIX DE L'ŒIL */}
        {resultsStep === 4 && (
          <div className="results-step">
            <h1 className="results-title">👁️ PRIX DE L'ŒIL 👁️</h1>
            <div className="eyeprize-container">
              {resultsData.eyePrize ? (
                <div className="eyeprize-card">
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
              ) : (
                <div className="eyeprize-placeholder">
                  <div className="placeholder-icon">👁️</div>
                  <p>Sélection en cours...</p>
                </div>
              )}
            </div>
            <div className="oral-announce">
              <p>🎤 Le jury va maintenant donner son avis oralement...</p>
            </div>
          </div>
        )}

        {/* ÉTAPE 5: FIN DE LA CÉRÉMONIE */}
        {resultsStep === 5 && (
          <div className="results-step">
            <div className="end-ceremony">
              <div className="end-icon">🏆</div>
              <h1 className="results-title">FIN DE LA CÉRÉMONIE</h1>
              <p className="end-message">Merci à tous les participants !</p>
              <p className="end-sub">Rendez-vous pour la prochaine édition</p>
            </div>
          </div>
        )}

        {/* Indicateur d'étape */}
        <div className="step-indicator">
          {resultsStep === 0 && <span>❤️ Coups de cœur</span>}
          {resultsStep === 1 && <span>🏆 Prix par catégorie</span>}
          {resultsStep === 2 && <span>📊 Classement (sans scores)</span>}
          {resultsStep === 3 && <span>📊 Classement (avec scores)</span>}
          {resultsStep === 4 && <span>👁️ Prix de l'œil</span>}
          {resultsStep === 5 && <span>🏁 Fin</span>}
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

  // Mode résultats en attente
  if (mode === "results" && !resultsData?.published) {
    return (
      <div className="diapo-container diapo-waiting">
        <div className="waiting-content">
          <div className="waiting-icon">🏆</div>
          <h1>Préparation des résultats</h1>
          <p>Les résultats seront bientôt disponibles...</p>
        </div>
        <LogoutButton />
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
          <button className="retry-btn" onClick={checkStatus}>
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
        <p className="waiting-note">
          Rafraîchissement automatique toutes les 2s
        </p>
      </div>
      <LogoutButton />
    </div>
  );
}
