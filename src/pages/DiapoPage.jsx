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
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [resultsPublished, setResultsPublished] = useState(false);
  const [resultsStep, setResultsStep] = useState(0);
  const [currentRevealIndex, setCurrentRevealIndex] = useState(0);
  const [rankingRevealIndex, setRankingRevealIndex] = useState(0);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waitingForSession, setWaitingForSession] = useState(false);

  // Vérifier l'état des sessions
  const checkSessionStatus = useCallback(async () => {
    try {
      const sessions = await api.get("/deliberations/active");
      const openSession = sessions?.find((s) => s.status === "open");

      if (openSession) {
        setWaitingForSession(false);
        setSessionCompleted(false);
        await loadCurrentPhoto(openSession);
        setMode("notation");
      } else {
        // Vérifier s'il y a une session terminée
        const allSessions = await api.get("/deliberations");
        const completedSession = allSessions?.find(
          (s) => s.status === "completed",
        );

        if (completedSession && !sessionCompleted) {
          setSessionCompleted(true);
          await loadAllPhotos(completedSession.category_id);
          setMode("gallery");
        } else if (!openSession && !completedSession) {
          setWaitingForSession(true);
          setCurrentPhoto(null);
          setMode("notation");
        }
      }
    } catch (e) {
      console.error("Erreur vérification session:", e);
    }
  }, [sessionCompleted]);

  // Charger la photo en cours
  const loadCurrentPhoto = async (session) => {
    try {
      const data = await api.get(
        `/categories/${session.category_id}/current-photo`,
      );
      if (data.photo) {
        setCurrentPhoto(data.photo);
        setCurrentCategory(session.categories?.name);
      }
    } catch (e) {
      console.error("Erreur chargement photo:", e);
    }
  };

  // Charger toutes les photos après notation
  const loadAllPhotos = async (categoryId) => {
    try {
      const data = await api.get(`/slideshow/all-photos/${categoryId}`);
      setAllPhotos(data.photos || []);
    } catch (e) {
      console.error("Erreur chargement toutes photos:", e);
    }
  };

  // Charger les résultats
  const loadResultsData = useCallback(async () => {
    try {
      const data = await api.get("/slideshow/results-data");
      if (data.published) {
        setResultsPublished(true);
        setResultsData(data);
        setResultsStep(0);
        setCurrentRevealIndex(0);
        setRankingRevealIndex(0);
        setScoresRevealed(false);
        setMode("results");
        setLoading(false);
      } else {
        setResultsPublished(false);
        setLoading(false);
      }
    } catch (e) {
      console.error("Erreur chargement résultats:", e);
      setLoading(false);
    }
  }, []);

  // Navigation dans les résultats (auto-avancement)
  const nextResultStep = useCallback(() => {
    if (resultsStep === 0) {
      const favorites = resultsData?.favorites || [];
      if (currentRevealIndex < favorites.length - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(1);
        setCurrentRevealIndex(0);
      }
    } else if (resultsStep === 1) {
      const winners = resultsData?.categoryWinners || [];
      if (currentRevealIndex < winners.length - 1) {
        setCurrentRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(2);
        setCurrentRevealIndex(0);
      }
    } else if (resultsStep === 2) {
      const ranking = resultsData?.generalRanking || [];
      if (rankingRevealIndex < ranking.length - 1) {
        setRankingRevealIndex((prev) => prev + 1);
      } else {
        setResultsStep(3);
      }
    } else if (resultsStep === 3) {
      setScoresRevealed(true);
      setResultsStep(4);
    } else if (resultsStep === 4) {
      setResultsStep(5);
    }
  }, [resultsStep, currentRevealIndex, rankingRevealIndex, resultsData]);

  // Auto-avancement des résultats
  useEffect(() => {
    if (mode !== "results" || !resultsData) return;
    const timer = setTimeout(nextResultStep, 8000);
    return () => clearTimeout(timer);
  }, [
    mode,
    resultsData,
    resultsStep,
    currentRevealIndex,
    rankingRevealIndex,
    nextResultStep,
  ]);

  // Écouter les changements
  useEffect(() => {
    checkSessionStatus();
    loadResultsData();

    const unsubSessions = subscribe("deliberation_sessions", "*", () => {
      checkSessionStatus();
    });

    const unsubResults = subscribe("results", "*", () => {
      loadResultsData();
    });

    return () => {
      unsubSessions();
      unsubResults();
    };
  }, [checkSessionStatus, loadResultsData]);

  if (loading) {
    return (
      <div className="diapo-loading">
        <div className="spinner spinner-lg" />
        <p>Chargement du diaporama...</p>
      </div>
    );
  }

  // Mode notation - photo en cours
  if (mode === "notation" && currentPhoto && !waitingForSession) {
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
          {allPhotos.map((photo, idx) => (
            <div key={photo.id} className="diapo-photo-item">
              <img src={photo.url} alt="" />
            </div>
          ))}
        </div>
        <div className="diapo-status">🎬 Fin de la notation</div>
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
      <div className="diapo-container diapo-results">
        {resultsStep === 0 && (
          <div className="results-step">
            <h1 className="results-title">❤️ COUPS DE CŒUR DU JURY</h1>
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

        {resultsStep === 1 && (
          <div className="results-step">
            <h1 className="results-title">🏆 PRIX PAR CATÉGORIE</h1>
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
                  </div>
                ))}
            </div>
          </div>
        )}

        {resultsStep === 2 && (
          <div className="results-step">
            <h1 className="results-title">📊 CLASSEMENT GÉNÉRAL</h1>
            <div className="results-ranking">
              {revealedRanking
                .slice()
                .reverse()
                .map((item, idx) => (
                  <div
                    key={item.anonymousId}
                    className={`ranking-card rank-${item.rank}`}
                  >
                    <div className="ranking-position">
                      {item.rank === 1 && "🥇"}
                      {item.rank === 2 && "🥈"}
                      {item.rank === 3 && "🥉"}
                      {item.rank > 3 && `${item.rank}e`}
                    </div>
                    <div className="ranking-name">{item.anonymousId}</div>
                    {!scoresRevealed && (
                      <div className="ranking-placeholder">??? pts</div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {resultsStep === 3 && (
          <div className="results-step">
            <h1 className="results-title">📊 CLASSEMENT GÉNÉRAL</h1>
            <div className="results-ranking with-scores">
              {ranking.map((item, idx) => (
                <div
                  key={item.anonymousId}
                  className={`ranking-card rank-${item.rank}`}
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

        {resultsStep === 4 && resultsData.eyePrize && (
          <div className="results-step">
            <h1 className="results-title">👁️ PRIX DE L'ŒIL</h1>
            <div className="results-eyeprize">
              <div className="eyeprize-card fade-in">
                {resultsData.eyePrize.url && (
                  <img src={resultsData.eyePrize.url} alt="" />
                )}
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

        {resultsStep === 5 && (
          <div className="results-step">
            <h1 className="results-title">🏆 FÉLICITATIONS ! 🏆</h1>
            <div className="results-end">
              <div className="end-icon">🎉</div>
              <p>Merci pour votre participation</p>
            </div>
          </div>
        )}
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
      </div>
    </div>
  );
}
