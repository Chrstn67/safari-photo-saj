// frontend/src/pages/JuryPage.jsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../server/hooks/useAuth.jsx";
import { api } from "../../server/utils/api.js";
import { subscribe } from "../../server/utils/realtime.js";
import TopBar from "../components/TopBar.jsx";

export default function JuryPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("notation");
  const [sessions, setSessions] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [scores, setScores] = useState({});
  const [validated, setValidated] = useState(false);
  const [validations, setValidations] = useState([]);
  const [flash, setFlash] = useState("");
  const [slideshowMode, setSlideshowMode] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [loadingPhoto, setLoadingPhoto] = useState(false);

  const TABS = [
    { id: "notation", label: "Notation", icon: "📋" },
    { id: "palmares", label: "Palmarès", icon: "🏆" },
  ];

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }

  const loadSessions = useCallback(async () => {
    try {
      const [sess, crit] = await Promise.all([
        api.get("/deliberations/active"),
        api.get("/criteria"),
      ]);
      setSessions(sess);
      setCriteria(crit);
      const open = sess.find((s) => s.status === "open");
      if (open) {
        setActiveSession(open);
        if (open.current_photo?.url) {
          setCurrentPhoto(open.current_photo);
        } else if (open.current_photo?.id) {
          await loadCurrentPhoto(open.category_id, open.current_photo.id);
        }
      } else {
        setActiveSession(null);
        setCurrentPhoto(null);
      }
    } catch (e) {
      console.error(e);
      showFlash("❌ " + e.message);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSession?.current_photo?.id) return;
    loadCurrentPhoto(activeSession.category_id, activeSession.current_photo.id);
  }, [activeSession?.current_photo?.id]);

  async function loadCurrentPhoto(categoryId, photoId) {
    if (!photoId) return;
    setLoadingPhoto(true);
    try {
      const [photoData, myScores, vals] = await Promise.all([
        api.get(`/categories/${categoryId}/current-photo`),
        api.get(`/scores/${photoId}`),
        api.get(`/deliberations/${categoryId}/validations`),
      ]);
      setCurrentPhoto(photoData.photo);

      const scoreMap = {};
      (myScores || []).forEach((s) => {
        scoreMap[s.criterion_id] = s.value;
      });
      setScores(scoreMap);

      const myVal = vals.validations?.find((v) => v.jurorId === user.id);
      setValidated(!!myVal?.validated);
      setValidations(vals.validations || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPhoto(false);
    }
  }

  // Abonnements Realtime pour mises à jour automatiques
  useEffect(() => {
    if (!activeSession) return;

    // Abonnement aux validations
    const unsubValidations = subscribe("jury_validations", "*", () => {
      api
        .get(`/deliberations/${activeSession.category_id}/validations`)
        .then((v) => setValidations(v.validations || []));
    });

    // Abonnement aux sessions (détecter changement de photo)
    const unsubSessions = subscribe(
      "deliberation_sessions",
      "UPDATE",
      async (payload) => {
        if (payload.new.category_id === activeSession.category_id) {
          // Mettre à jour la session
          setSessions((prev) =>
            prev.map((s) =>
              s.category_id === activeSession.category_id
                ? { ...s, ...payload.new, categories: s.categories }
                : s,
            ),
          );

          // Mettre à jour activeSession
          setActiveSession((prev) => ({
            ...prev,
            ...payload.new,
            categories: prev?.categories,
          }));

          // Si l'ID de la photo a changé, recharger
          if (
            payload.new.current_photo_id !== activeSession.current_photo?.id
          ) {
            setValidated(false);
            setScores({});
            if (payload.new.current_photo_id) {
              await loadCurrentPhoto(
                activeSession.category_id,
                payload.new.current_photo_id,
              );
            } else {
              setCurrentPhoto(null);
            }
          }
        }
      },
    );

    // Abonnement aux scores (pour mises à jour en temps réel)
    const unsubScores = subscribe("scores", "INSERT", (payload) => {
      if (
        payload.new.submission_id === currentPhoto?.id &&
        payload.new.juror_id === user.id
      ) {
        setScores((prev) => ({
          ...prev,
          [payload.new.criterion_id]: payload.new.value,
        }));
      }
    });

    return () => {
      unsubValidations();
      unsubSessions();
      unsubScores();
    };
  }, [
    activeSession?.category_id,
    activeSession?.current_photo?.id,
    currentPhoto?.id,
    user.id,
  ]);

  async function handleScoreChange(criterionId, value) {
    if (validated) return;
    const criterion = criteria.find((c) => c.id === criterionId);
    const v = Math.max(
      0,
      Math.min(criterion?.max_points || 5, parseFloat(value) || 0),
    );
    setScores((prev) => ({ ...prev, [criterionId]: v }));
    try {
      await api.put("/scores", {
        submissionId: currentPhoto.id,
        criterionId,
        value: v,
      });
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function handleValidate() {
    if (!currentPhoto) return;
    try {
      const res = await api.post("/scores/validate", {
        submissionId: currentPhoto.id,
      });
      setValidated(true);
      showFlash("✅ Notes validées !");

      // Si tous les jurés ont validé, l'auto-next est déclenché côté serveur
      if (res.allValidated) {
        showFlash("✅ Tous ont validé — passage automatique…");
        // Recharger les données après un court délai
        setTimeout(() => {
          loadSessions();
        }, 1500);
      }
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function handleFavorite() {
    if (!currentPhoto || !activeSession) return;
    try {
      const res = await api.post("/scores/favorite", {
        submissionId: currentPhoto.id,
        categoryId: activeSession.category_id,
      });
      showFlash(
        res.removed
          ? "💔 Coup de cœur retiré"
          : res.replaced
            ? "❤️ Coup de cœur modifié"
            : "❤️ Coup de cœur attribué !",
      );
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  const total = Object.values(scores).reduce(
    (a, b) => a + (parseFloat(b) || 0),
    0,
  );
  const maxTotal = criteria.reduce((a, c) => a + (c.max_points || 5), 0);

  // Mode diaporama
  if (slideshowMode && activeSession && currentPhoto) {
    return (
      <div className="slideshow">
        {currentPhoto.url ? (
          <img src={currentPhoto.url} alt="" />
        ) : (
          <div style={{ color: "#fff", fontSize: "2rem" }}>⏳ Chargement…</div>
        )}
        <div className="slideshow-id">{currentPhoto.anonymous_id}</div>
        <button
          className="slideshow-exit"
          onClick={() => setSlideshowMode(false)}
        >
          ✕ Quitter
        </button>
      </div>
    );
  }

  return (
    <>
      <TopBar
        title={
          <>
            📸 Safari · <span>Jury</span>
          </>
        }
        right={
          <>
            <span className="topbar-user">{user?.firstName}</span>
            <button
              className="btn btn-sm menu-toggle"
              style={{
                borderColor: "rgba(255,255,255,.25)",
                color: "var(--sand)",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              onClick={() => setShowMobileMenu(!showMobileMenu)}
            >
              ☰ Menu
            </button>
            <button
              className="btn btn-sm"
              style={{
                borderColor: "rgba(255,255,255,.25)",
                color: "var(--sand)",
                background: "transparent",
              }}
              onClick={logout}
            >
              Déco
            </button>
          </>
        }
      />

      <div className={`app-layout ${showMobileMenu ? "mobile-menu-open" : ""}`}>
        <div className="side-panel">
          <nav className="side-nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`side-tab${tab === t.id ? " active" : ""}`}
                onClick={() => {
                  setTab(t.id);
                  setShowMobileMenu(false);
                }}
              >
                <span className="tab-icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
          {activeSession && (
            <div className="side-info">
              <div className="side-info-label">Session active</div>
              <div className="side-info-value">
                {activeSession.categories?.name || "Aucune"}
              </div>
              <button
                className="btn btn-sm btn-full"
                style={{
                  marginTop: "1rem",
                  background: "var(--amber)",
                  color: "#fff",
                }}
                onClick={() => setSlideshowMode(true)}
              >
                📽️ Mode Diaporama
              </button>
            </div>
          )}
        </div>

        <div className="main-content">
          <div className="page">
            {tab === "notation" && (
              <>
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">Catégorie en cours</div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: ".5rem",
                      flexWrap: "wrap",
                      marginBottom: "1rem",
                    }}
                  >
                    {sessions
                      .filter((s) => s.status === "open")
                      .map((s) => (
                        <button
                          key={s.category_id}
                          className={`btn${activeSession?.category_id === s.category_id ? " btn-primary" : ""}`}
                          onClick={async () => {
                            setActiveSession(s);
                            if (s.current_photo?.id) {
                              await loadCurrentPhoto(
                                s.category_id,
                                s.current_photo.id,
                              );
                            }
                          }}
                        >
                          {s.categories?.name}
                        </button>
                      ))}
                    {sessions.filter((s) => s.status === "open").length ===
                      0 && (
                      <div
                        className="info-banner banner-amber"
                        style={{ width: "100%" }}
                      >
                        <span className="banner-icon">⏳</span>
                        Aucune délibération en cours. L'administrateur doit
                        ouvrir une catégorie.
                      </div>
                    )}
                  </div>
                </div>

                {activeSession && currentPhoto && (
                  <>
                    <div className="section">
                      <div className="section-header">
                        <div className="section-title">
                          <span
                            className="badge badge-ink"
                            style={{ marginRight: ".5rem" }}
                          >
                            {currentPhoto.anonymous_id}
                          </span>
                          Photo {currentPhoto.display_order}
                        </div>
                        {validated && (
                          <span className="badge badge-green">✅ Validé</span>
                        )}
                      </div>

                      <div className="panel" style={{ marginBottom: "1rem" }}>
                        {loadingPhoto ? (
                          <div
                            style={{
                              height: 400,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ink-faint)",
                            }}
                          >
                            <span className="spinner spinner-lg" />
                          </div>
                        ) : currentPhoto.url ? (
                          <img
                            src={currentPhoto.url}
                            alt=""
                            style={{
                              width: "100%",
                              maxHeight: 400,
                              objectFit: "contain",
                              background: "#000",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              height: 200,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ink-faint)",
                            }}
                          >
                            Chargement…
                          </div>
                        )}
                      </div>

                      <div className="panel">
                        {criteria.map((c) => (
                          <div key={c.id} className="score-row">
                            <span className="score-label">
                              {c.icon} {c.name}
                            </span>
                            <div className="score-input-wrap">
                              <input
                                type="number"
                                className="score-inp"
                                step=".5"
                                min="0"
                                max={c.max_points}
                                value={scores[c.id] ?? 0}
                                onChange={(e) =>
                                  handleScoreChange(c.id, e.target.value)
                                }
                                disabled={validated}
                              />
                              <span className="score-max">
                                / {c.max_points}
                              </span>
                            </div>
                          </div>
                        ))}
                        <div
                          style={{
                            padding: ".75rem 1rem",
                            borderTop: "1px solid var(--sand-border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "1rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <span className="score-total">
                            {total.toFixed(1)} / {maxTotal} pts
                          </span>
                          <div style={{ display: "flex", gap: ".5rem" }}>
                            <button
                              className={`btn${validated ? "" : " btn-primary"}`}
                              onClick={handleValidate}
                              disabled={validated}
                            >
                              {validated ? "✅ Validé" : "Valider mes notes"}
                            </button>
                            <button
                              className="btn"
                              onClick={handleFavorite}
                              title="Coup de cœur"
                            >
                              ❤️
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="section">
                      <div className="section-header">
                        <div className="section-title">
                          État des validations
                        </div>
                      </div>
                      <div className="panel">
                        <div className="validation-grid">
                          {validations.map((v) => (
                            <div key={v.jurorId} className="validation-chip">
                              <span
                                className={`v-dot ${v.validated ? "validated" : "pending"}`}
                              />
                              {v.name}
                              {v.validated ? " ✅" : " ⏳"}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeSession && !currentPhoto && !loadingPhoto && (
                  <div className="info-banner banner-amber">
                    <span className="banner-icon">📸</span>
                    Aucune photo en cours dans cette catégorie.
                  </div>
                )}
              </>
            )}

            {tab === "palmares" && (
              <PalmaresView showFlash={showFlash} user={user} />
            )}
          </div>
        </div>
      </div>

      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`bottom-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {flash && <div className="flash">{flash}</div>}
    </>
  );
}

function PalmaresView({ showFlash, user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showTieModal, setShowTieModal] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [voting, setVoting] = useState(false);
  const [tieBreakerVotes, setTieBreakerVotes] = useState({});

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await api.get("/results/palmares");
      console.log("[PalmaresView] Données reçues:", result);
      setData(result);

      // Vérifier s'il y a une égalité pour le prix de l'œil
      if (result.eyePrize?.isTieForFirst && !result.eyePrize?.isFinalized) {
        setShowTieModal(true);
      }
    } catch (e) {
      console.error("[PalmaresView] Erreur:", e);
      showFlash?.(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleVote = async (submissionId) => {
    setVoting(true);
    try {
      await api.post("/results/eye-prize/vote", { submissionId });
      showFlash("✅ Vote enregistré !");
      await loadData();
      setShowVoteModal(false);
      setSelectedPhoto(null);
    } catch (e) {
      showFlash("❌ " + e.message);
    } finally {
      setVoting(false);
    }
  };

  const handleTieBreakerVote = async (submissionId) => {
    setVoting(true);
    try {
      await api.post("/results/eye-prize/vote", { submissionId });
      showFlash("✅ Vote d'égalité enregistré !");
      await loadData();
      setShowTieModal(false);
    } catch (e) {
      showFlash("❌ " + e.message);
    } finally {
      setVoting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  if (!data || !data.generalRanking?.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🏆</div>
        <div className="empty-title">Résultats non disponibles</div>
        <p>Les résultats seront publiés prochainement.</p>
      </div>
    );
  }

  const isJuror = user?.role === "juror" || user?.role === "admin";
  const hasVoted = data.eyePrize?.myVote !== null;
  const eyeVotes = data.eyePrize?.votes || [];
  const isTie = data.eyePrize?.isTieForFirst === true;
  const tiedPhotos = data.eyePrize?.tiedPhotos || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Photo d'Or - Meilleur Photographe */}
      {data.bestPhotographer && (
        <div className="section">
          <div className="section-header">
            <div className="section-title">
              🏆 Photo d'Or — Meilleur Photographe
            </div>
          </div>
          <div
            className="card"
            style={{
              textAlign: "center",
              background: "linear-gradient(135deg, #FFD70020, #FFA50020)",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: ".5rem" }}>🏆</div>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: "1.4rem",
                color: "var(--amber)",
              }}
            >
              {data.bestPhotographer.name}
            </div>
            <div
              style={{
                fontSize: ".8rem",
                color: "var(--ink-muted)",
                marginTop: ".25rem",
              }}
            >
              {data.bestPhotographer.total.toFixed(1)} points totaux ·{" "}
              {data.bestPhotographer.finalists} victoire(s) par catégorie
            </div>
          </div>
        </div>
      )}

      {/* 2. Classement général */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">📊 Classement général</div>
        </div>
        <div className="panel">
          {data.generalRanking.slice(0, 10).map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: ".75rem 1rem",
                borderBottom:
                  i < data.generalRanking.length - 1
                    ? "1px solid var(--sand-border)"
                    : "none",
              }}
            >
              <span
                style={{ fontSize: i < 3 ? "1.5rem" : "1rem", width: "40px" }}
              >
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
              <span className="badge badge-amber">
                {p.total?.toFixed(1)} pts
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Prix par catégorie */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">🏅 Prix par catégorie</div>
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}
        >
          {(data.byCategory || [])
            .filter((r) => r.rank === 1)
            .map((winner, idx) => {
              const categoryName = winner.categories?.name;
              const authorName = winner.author;
              return (
                <div key={idx} className="card">
                  <div
                    style={{
                      fontSize: ".72rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {categoryName}
                  </div>
                  <div
                    style={{
                      fontFamily: "'DM Serif Display', serif",
                      fontSize: "1.1rem",
                      color: "var(--amber)",
                      marginTop: ".25rem",
                    }}
                  >
                    🥇{" "}
                    {authorName ||
                      winner.submissions?.anonymous_id ||
                      "Anonyme"}
                  </div>
                  <div
                    style={{
                      fontSize: ".8rem",
                      color: "var(--ink-muted)",
                      marginTop: ".25rem",
                    }}
                  >
                    Moyenne : {winner.average_score?.toFixed(1)}/20
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* 4. Coups de cœur du jury - AVEC PHOTOS ET NOMS */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">❤️ Coups de cœur du jury</div>
        </div>
        {data.favorites && data.favorites.length > 0 ? (
          <div
            className="photo-grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            }}
          >
            {data.favorites.map((fav, idx) => (
              <div key={idx} className="card" style={{ padding: "1rem" }}>
                {fav.photoUrl ? (
                  <img
                    src={fav.photoUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: "180px",
                      objectFit: "cover",
                      borderRadius: "8px",
                      marginBottom: ".75rem",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "180px",
                      background: "var(--sand-dark)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "8px",
                      marginBottom: ".75rem",
                      fontSize: "3rem",
                    }}
                  >
                    📷
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: ".9rem" }}>
                  {fav.participantName}
                </div>
                <div style={{ fontSize: ".75rem", color: "var(--ink-muted)" }}>
                  {fav.anonymousId}
                </div>
                <div
                  style={{
                    fontSize: ".7rem",
                    color: "var(--ink-faint)",
                    marginTop: ".25rem",
                  }}
                >
                  Catégorie : {fav.categoryName}
                </div>
                <div
                  className="badge badge-amber"
                  style={{ marginTop: ".5rem", display: "inline-block" }}
                >
                  ❤️ {fav.count} coup(s) de cœur
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="info-banner banner-amber">
            <span className="banner-icon">⏳</span>
            Aucun coup de cœur n'a encore été attribué.
          </div>
        )}
      </div>

      {/* 5. Prix de l'œil */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">
            👁️ Prix de l'œil — Photo la plus originale
          </div>
        </div>

        {data.eyePrize?.isFinalized ? (
          <div className="card" style={{ textAlign: "center" }}>
            {data.eyePrize.finalResult?.submissions?.photoUrl && (
              <img
                src={data.eyePrize.finalResult.submissions.photoUrl}
                alt="Photo gagnante"
                style={{
                  width: "100%",
                  maxHeight: 300,
                  objectFit: "contain",
                  borderRadius: 8,
                  marginBottom: "1rem",
                }}
              />
            )}
            <div style={{ fontSize: "2.5rem", marginBottom: ".5rem" }}>
              👁️✨
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: "1.2rem",
                color: "var(--amber)",
              }}
            >
              {data.eyePrize.finalResult?.submissions?.anonymous_id}
            </div>
            <div style={{ fontSize: ".8rem", color: "var(--ink-muted)" }}>
              {data.eyePrize.finalResult?.submissions?.users &&
                `par ${data.eyePrize.finalResult.submissions.users.first_name} ${data.eyePrize.finalResult.submissions.users.last_name}`}
              {data.eyePrize.finalResult?.submissions?.categories?.name &&
                ` · ${data.eyePrize.finalResult.submissions.categories.name}`}
            </div>
            <div className="badge badge-amber" style={{ marginTop: ".5rem" }}>
              {data.eyePrize.finalResult?.total_votes || 0} vote(s)
            </div>
          </div>
        ) : (
          <>
            {/* Résumé des votes en cours avec photos */}
            {eyeVotes.length > 0 && (
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <div
                  className="section-header"
                  style={{
                    padding: "0.75rem 1rem",
                    marginBottom: 0,
                    borderBottom: "1px solid var(--sand-border)",
                  }}
                >
                  <div className="section-title">📊 Votes actuels</div>
                  <button
                    className="btn btn-sm"
                    onClick={() => setShowResultsModal(true)}
                  >
                    Voir tous les votes
                  </button>
                </div>
                <div
                  className="photo-grid"
                  style={{
                    padding: "0.75rem",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(160px, 1fr))",
                  }}
                >
                  {eyeVotes.slice(0, 3).map((vote, idx) => (
                    <div
                      key={idx}
                      className="card"
                      style={{ textAlign: "center", padding: ".5rem" }}
                    >
                      {vote.photoUrl ? (
                        <img
                          src={vote.photoUrl}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100px",
                            objectFit: "cover",
                            borderRadius: "6px",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100px",
                            background: "var(--sand-dark)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "6px",
                            fontSize: "2rem",
                          }}
                        >
                          📷
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: ".7rem",
                          fontWeight: 600,
                          marginTop: ".25rem",
                        }}
                      >
                        {vote.participantName}
                      </div>
                      <div
                        style={{
                          fontSize: ".65rem",
                          color: "var(--ink-muted)",
                        }}
                      >
                        {vote.anonymousId}
                      </div>
                      <span
                        className="badge badge-amber"
                        style={{ fontSize: ".65rem", marginTop: ".25rem" }}
                      >
                        {vote.votes} voix
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Message d'égalité */}
            {isTie && (
              <div
                className="info-banner banner-red"
                style={{ marginBottom: "1rem" }}
              >
                <span className="banner-icon">⚠️</span>
                <span>
                  <strong>Égalité détectée !</strong> Plusieurs photos sont à
                  égalité pour la première place. Les jurés doivent voter à
                  nouveau pour départager les photos ci-dessous.
                </span>
              </div>
            )}

            {/* Mon vote */}
            <div
              className="info-banner banner-amber"
              style={{ marginBottom: "1rem" }}
            >
              <span className="banner-icon">🗳️</span>
              {hasVoted ? (
                <span>
                  Vous avez voté pour{" "}
                  <strong>
                    {data.eyePrize?.myVote?.anonymousId || "une photo"}
                  </strong>
                  . Vous pouvez modifier votre vote à tout moment.
                </span>
              ) : (
                <span>
                  Vous n'avez pas encore voté. Sélectionnez votre photo préférée
                  !
                </span>
              )}
            </div>

            {/* Bouton pour voter */}
            <button
              className="btn btn-primary btn-full"
              onClick={() => setShowVoteModal(true)}
            >
              {hasVoted
                ? "🔄 Modifier mon vote"
                : "🗳️ Voter pour ma photo préférée"}
            </button>
          </>
        )}
      </div>

      {/* MODAL DE VOTE - AVEC TOUTES LES PHOTOS */}
      {showVoteModal && (
        <div className="modal-backdrop" onClick={() => setShowVoteModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: "700px", maxHeight: "80dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>👁️ Sélectionnez votre photo préférée</h3>
              <button
                className="btn btn-sm"
                onClick={() => setShowVoteModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto" }}>
              <div
                className="photo-grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                }}
              >
                {(data.allSubmissions || []).map((sub) => (
                  <div
                    key={sub.id}
                    className={`photo-item ${data.eyePrize?.myVote?.submissionId === sub.id ? "selected" : ""}`}
                    onClick={() => setSelectedPhoto(sub)}
                    style={{
                      cursor: "pointer",
                      border:
                        data.eyePrize?.myVote?.submissionId === sub.id
                          ? "3px solid var(--amber)"
                          : "1.5px solid var(--sand-border)",
                    }}
                  >
                    {sub.photoUrl ? (
                      <img
                        src={sub.photoUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "var(--sand-dark)",
                          fontSize: "2rem",
                        }}
                      >
                        📷
                      </div>
                    )}
                    <div
                      className="photo-overlay"
                      style={{
                        opacity: 1,
                        background:
                          "linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 70%)",
                      }}
                    >
                      <div
                        style={{
                          color: "#fff",
                          fontSize: ".7rem",
                          textAlign: "center",
                          width: "100%",
                        }}
                      >
                        {sub.participantName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowVoteModal(false)}>
                Annuler
              </button>
              {selectedPhoto && (
                <button
                  className="btn btn-primary"
                  onClick={() => handleVote(selectedPhoto.id)}
                  disabled={voting}
                >
                  {voting ? "⏳" : "✅ Confirmer mon vote"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DES RÉSULTATS DES VOTES */}
      {showResultsModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowResultsModal(false)}
        >
          <div
            className="modal"
            style={{ maxWidth: "600px", maxHeight: "80dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>📊 Résultats des votes — Prix de l'œil</h3>
              <button
                className="btn btn-sm"
                onClick={() => setShowResultsModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto" }}>
              {eyeVotes.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "var(--ink-muted)",
                  }}
                >
                  Aucun vote enregistré pour le moment.
                </div>
              ) : (
                <div
                  className="photo-grid"
                  style={{ gridTemplateColumns: "1fr" }}
                >
                  {eyeVotes
                    .sort((a, b) => b.votes - a.votes)
                    .map((vote, idx) => (
                      <div
                        key={idx}
                        className="card"
                        style={{
                          padding: "1rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "1rem",
                          flexWrap: "wrap",
                        }}
                      >
                        {vote.photoUrl && (
                          <img
                            src={vote.photoUrl}
                            alt=""
                            style={{
                              width: "60px",
                              height: "60px",
                              objectFit: "cover",
                              borderRadius: "8px",
                            }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>
                            {vote.participantName}
                          </div>
                          <div
                            style={{
                              fontSize: ".75rem",
                              color: "var(--ink-muted)",
                            }}
                          >
                            {vote.anonymousId}
                          </div>
                        </div>
                        <div>
                          <span
                            className="badge badge-amber"
                            style={{ fontSize: "1rem", padding: ".3rem 1rem" }}
                          >
                            {vote.votes} voix
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn"
                onClick={() => setShowResultsModal(false)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL D'ÉGALITÉ - DÉPARTAGE */}
      {showTieModal && tiedPhotos.length > 0 && (
        <div className="modal-backdrop" onClick={() => setShowTieModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: "700px", maxHeight: "80dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>⚠️ Égalité — Départagez les photos</h3>
              <button
                className="btn btn-sm"
                onClick={() => setShowTieModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: "1rem", color: "var(--ink-muted)" }}>
                Plusieurs photos sont à égalité. Veuillez voter pour celle que
                vous préférez.
              </p>
              <div
                className="photo-grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                }}
              >
                {tiedPhotos.map((photo) => (
                  <div
                    key={photo.submissionId}
                    className="card"
                    style={{
                      textAlign: "center",
                      padding: "1rem",
                      cursor: "pointer",
                      border: tieBreakerVotes[photo.submissionId]
                        ? "3px solid var(--amber)"
                        : "1px solid var(--sand-border)",
                    }}
                    onClick={() => {
                      setTieBreakerVotes({ [photo.submissionId]: true });
                      handleTieBreakerVote(photo.submissionId);
                    }}
                  >
                    {photo.photoUrl ? (
                      <img
                        src={photo.photoUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "150px",
                          objectFit: "cover",
                          borderRadius: "8px",
                          marginBottom: ".5rem",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "150px",
                          background: "var(--sand-dark)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "8px",
                          marginBottom: ".5rem",
                          fontSize: "3rem",
                        }}
                      >
                        📷
                      </div>
                    )}
                    <div style={{ fontWeight: 700 }}>
                      {photo.participantName}
                    </div>
                    <div
                      style={{ fontSize: ".75rem", color: "var(--ink-muted)" }}
                    >
                      {photo.anonymousId}
                    </div>
                    <div
                      className="badge badge-amber"
                      style={{ marginTop: ".5rem" }}
                    >
                      {photo.votes} voix
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowTieModal(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
