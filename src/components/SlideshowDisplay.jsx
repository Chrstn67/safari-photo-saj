// frontend/src/components/SlideshowDisplay.jsx
import { useState, useEffect, useCallback } from "react";
import { api } from "../../server/utils/api.js";
import { subscribe } from "../../server/utils/realtime.js";

export default function SlideshowDisplay({ mode = "notation", onExit }) {
  // mode: 'notation' | 'results'
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [allPhotos, setAllPhotos] = useState([]);
  const [showAllPhotos, setShowAllPhotos] = useState(false);

  // Mode résultats
  const [resultsStep, setResultsStep] = useState(0); // 0=favorites, 1=categoryWinners, 2=ranking, 3=scores, 4=eyePrize
  const [resultsData, setResultsData] = useState(null);
  const [currentRevealIndex, setCurrentRevealIndex] = useState(0);
  const [rankingRevealIndex, setRankingRevealIndex] = useState(0);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [adminControls, setAdminControls] = useState(false);

  // ════════════════════════════════════════════════════════════════
  // MODE NOTATION - Photo en cours
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (mode !== "notation") return;

    const loadCurrentPhoto = async () => {
      try {
        const data = await api.get("/slideshow/current");
        if (data.hasPhoto) {
          setCurrentPhoto(data.photo);
          setCurrentCategory(data.category);
        }
      } catch (e) {
        console.error("Erreur chargement photo:", e);
      }
    };

    loadCurrentPhoto();

    // Écouter les changements de session
    const unsubscribe = subscribe(
      "deliberation_sessions",
      "UPDATE",
      async () => {
        const data = await api.get("/slideshow/current");
        if (data.hasPhoto) {
          setCurrentPhoto(data.photo);
          setCurrentCategory(data.category);
        } else {
          setCurrentPhoto(null);
        }
      },
    );

    return () => unsubscribe();
  }, [mode]);

  // ════════════════════════════════════════════════════════════════
  // FIN DE NOTATION - Afficher toutes les photos
  // ════════════════════════════════════════════════════════════════
  const loadAllPhotos = useCallback(async () => {
    try {
      const { data: activeSession } = await api.get("/deliberations/active");
      const openSession = activeSession?.find((s) => s.status === "open");
      if (openSession?.category_id) {
        const photos = await api.get(
          `/slideshow/all-photos/${openSession.category_id}`,
        );
        setAllPhotos(photos.photos || []);
        setShowAllPhotos(true);
      }
    } catch (e) {
      console.error("Erreur chargement photos:", e);
    }
  }, []);

  // Détecter quand la notation est terminée (session devient completed)
  useEffect(() => {
    if (mode !== "notation") return;

    const checkSessionComplete = subscribe(
      "deliberation_sessions",
      "UPDATE",
      async (payload) => {
        if (payload.new.status === "completed" && !showAllPhotos) {
          loadAllPhotos();
        }
      },
    );

    // Vérifier immédiatement
    const check = async () => {
      const { data: sessions } = await api.get("/deliberations");
      const completed = sessions?.find((s) => s.status === "completed");
      if (completed && !showAllPhotos) {
        loadAllPhotos();
      }
    };
    check();

    return () => checkSessionComplete();
  }, [mode, showAllPhotos, loadAllPhotos]);

  // ════════════════════════════════════════════════════════════════
  // MODE RÉSULTATS
  // ════════════════════════════════════════════════════════════════
  const loadResultsData = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/results-data");
      setResultsData(data);
      setResultsStep(0);
      setCurrentRevealIndex(0);
      setRankingRevealIndex(0);
      setScoresRevealed(false);
    } catch (e) {
      console.error("Erreur chargement résultats:", e);
    }
  }, []);

  useEffect(() => {
    if (mode === "results") {
      loadResultsData();
    }
  }, [mode, loadResultsData]);

  // Navigation dans les résultats (contrôles admin)
  const nextResultStep = () => {
    if (resultsStep === 0) {
      // Coups de cœur - révéler progressivement
      if (currentRevealIndex < (resultsData?.favorites?.length || 0) - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(1);
        setCurrentRevealIndex(0);
      }
    } else if (resultsStep === 1) {
      // Prix par catégorie - révéler progressivement
      if (
        currentRevealIndex <
        (resultsData?.categoryWinners?.length || 0) - 1
      ) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(2);
        setCurrentRevealIndex(0);
      }
    } else if (resultsStep === 2) {
      // Classement - révéler de la fin vers le début (en commençant par le dernier)
      const ranking = resultsData?.generalRanking || [];
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
      setCurrentRevealIndex((resultsData?.favorites?.length || 0) - 1);
    } else if (resultsStep === 2 && rankingRevealIndex > 0) {
      setRankingRevealIndex((prev) => prev - 1);
    } else if (resultsStep === 2 && rankingRevealIndex === 0) {
      setResultsStep(1);
      setCurrentRevealIndex((resultsData?.categoryWinners?.length || 0) - 1);
    } else if (resultsStep === 3) {
      setResultsStep(2);
      setRankingRevealIndex((resultsData?.generalRanking?.length || 0) - 1);
    } else if (resultsStep === 4) {
      setResultsStep(3);
      setScoresRevealed(false);
    } else if (resultsStep === 5) {
      setResultsStep(4);
    }
  };

  // ════════════════════════════════════════════════════════════════
  // RENDU
  // ════════════════════════════════════════════════════════════════

  // Mode notation avec photo en cours
  if (mode === "notation" && !showAllPhotos && currentPhoto) {
    return (
      <div className="slideshow slideshow--notation">
        <img src={currentPhoto.url} alt="" />
        {adminControls && (
          <div className="slideshow-controls">
            <button onClick={onExit} className="slideshow-exit">
              ✕ Quitter
            </button>
          </div>
        )}
      </div>
    );
  }

  // Mode notation - affichage de toutes les photos (fin de notation)
  if (mode === "notation" && showAllPhotos && allPhotos.length > 0) {
    return (
      <div className="slideshow slideshow--gallery">
        <div className="slideshow-gallery">
          {allPhotos.map((photo, idx) => (
            <div key={photo.id} className="slideshow-gallery-item">
              <img src={photo.url} alt="" />
            </div>
          ))}
        </div>
        {adminControls && (
          <button onClick={onExit} className="slideshow-exit">
            ✕ Quitter
          </button>
        )}
      </div>
    );
  }

  // Mode résultats
  if (mode === "results" && resultsData) {
    const ranking = resultsData.generalRanking || [];
    const revealedRanking = ranking.slice(
      ranking.length - 1 - rankingRevealIndex,
    );

    return (
      <div className="slideshow slideshow--results">
        {/* Étape 0: Coups de cœur */}
        {resultsStep === 0 && (
          <div className="results-step">
            <h1 className="results-title">❤️ COUPS DE CŒUR DU JURY ❤️</h1>
            <div className="results-favorites">
              {(resultsData.favorites || [])
                .slice(0, currentRevealIndex + 1)
                .map((fav, idx) => (
                  <div key={fav.submissionId} className="favorite-card fade-in">
                    {fav.url && <img src={fav.url} alt="" />}
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
              {(resultsData.categoryWinners || [])
                .slice(0, currentRevealIndex + 1)
                .map((winner, idx) => (
                  <div
                    key={winner.categoryId}
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
                  const isLastTwo = rankingRevealIndex >= ranking.length - 2;

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
                      {!scoresRevealed && !isLastTwo && (
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
                  className={`ranking-card rank-${item.rank === 1 ? "1" : item.rank === 2 ? "2" : item.rank === 3 ? "3" : ""} fade-in`}
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

        {/* Contrôles admin */}
        {adminControls && (
          <div className="slideshow-results-controls">
            <button onClick={prevResultStep} className="control-btn">
              ◀ Précédent
            </button>
            <button onClick={nextResultStep} className="control-btn">
              {resultsStep === 4 ? "Terminer" : "Suivant ▶"}
            </button>
            <button onClick={onExit} className="control-btn exit">
              ✕ Quitter
            </button>
          </div>
        )}
      </div>
    );
  }

  // Chargement
  return (
    <div className="slideshow slideshow--loading">
      <div className="spinner spinner-lg" />
      <p>Chargement...</p>
    </div>
  );
}
