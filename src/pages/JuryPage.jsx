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

  // Abonnements Realtime
  useEffect(() => {
    if (!activeSession) return;

    const unsubValidations = subscribe("jury_validations", "*", () => {
      api
        .get(`/deliberations/${activeSession.category_id}/validations`)
        .then((v) => setValidations(v.validations || []));
    });

    const unsubSessions = subscribe(
      "deliberation_sessions",
      "UPDATE",
      async (payload) => {
        if (payload.new.category_id === activeSession.category_id) {
          setSessions((prev) =>
            prev.map((s) =>
              s.category_id === activeSession.category_id
                ? { ...s, ...payload.new, categories: s.categories }
                : s,
            ),
          );
          setActiveSession((prev) => ({
            ...prev,
            ...payload.new,
            categories: prev?.categories,
          }));
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

    return () => {
      unsubValidations();
      unsubSessions();
    };
  }, [activeSession?.category_id, activeSession?.current_photo?.id]);

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
      if (res.allValidated) {
        showFlash("✅ Tous ont validé — passage automatique…");
        setTimeout(() => loadSessions(), 1500);
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
          <span>
            📸 Safari · <span>Jury</span>
          </span>
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
                            if (s.current_photo?.id)
                              await loadCurrentPhoto(
                                s.category_id,
                                s.current_photo.id,
                              );
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
                        <span className="banner-icon">⏳</span>Aucune
                        délibération en cours.
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

// ════════════════════════════════════════════════════════════════
// COMPOSANT PALMARÈS
// ════════════════════════════════════════════════════════════════
function PalmaresView({ showFlash, user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [eyePrizeData, setEyePrizeData] = useState(null);

  // Modals
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showTieModal, setShowTieModal] = useState(false);

  // Vote state
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [voting, setVoting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [tieSubmissions, setTieSubmissions] = useState([]);

  // Expanded favorite detail
  const [expandedFav, setExpandedFav] = useState(null);

  const isJuror = user?.role === "juror" || user?.role === "admin";

  const loadData = async () => {
    setLoading(true);
    try {
      const palmaresResult = await api.get("/results/palmares");
      setData(palmaresResult);

      // Prix de l'œil — disponible pour les jurés seulement
      if (isJuror) {
        const votesResult = await api
          .get("/results/eye-prize/votes")
          .catch(() => null);
        setEyePrizeData(votesResult);
      }
    } catch (e) {
      console.error(e);
      showFlash?.("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ── Vote Prix de l'œil ──────────────────────────────────────
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

  // ── Finalisation Prix de l'œil ──────────────────────────────
  const handleFinalize = async (submissionId) => {
    setFinalizing(true);
    try {
      await api.post("/results/eye-prize/finalize", { submissionId });
      showFlash("✅ Prix de l'œil finalisé !");
      await loadData();
      setShowResultsModal(false);
      setShowTieModal(false);
    } catch (e) {
      if (e.hasTie) {
        setTieSubmissions(e.tiedSubmissions || []);
        setShowTieModal(true);
        showFlash("⚠️ Égalité détectée — délibération nécessaire.");
      } else {
        showFlash("❌ " + e.message);
      }
    } finally {
      setFinalizing(false);
    }
  };

  if (loading)
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <span className="spinner spinner-lg" />
      </div>
    );

  const hasVoted = eyePrizeData?.myVote != null;
  const voteCounts = eyePrizeData?.voteCounts || [];
  const finalResult = eyePrizeData?.finalResult;
  const hasTie = eyePrizeData?.hasTie;
  const favoriteCounts = data?.favoriteCounts || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* ── 1. Photo d'Or ───────────────────────────────────────── */}
      {data?.bestPhotographer && (
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
              {data.bestPhotographer.total?.toFixed(1)} points totaux ·{" "}
              {data.bestPhotographer.finalists} victoire(s)
            </div>
          </div>
        </div>
      )}

      {/* ── 2. Classement général ───────────────────────────────── */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">📊 Classement général</div>
        </div>
        <div className="panel">
          {data?.generalRanking?.slice(0, 10).map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: ".75rem 1rem",
                borderBottom: "1px solid var(--sand-border)",
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

      {/* ── 3. Prix par catégorie ───────────────────────────────── */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">🏅 Prix par catégorie</div>
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}
        >
          {(data?.byCategory || [])
            .filter((r) => r.rank === 1)
            .map((winner, idx) => (
              <div key={idx} className="card">
                <div
                  style={{
                    fontSize: ".72rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                  }}
                >
                  {winner.categories?.name}
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
                  {winner.author ||
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
            ))}
        </div>
      </div>

      {/* ── 4. Coups de cœur du jury ────────────────────────────── */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">❤️ Coups de cœur du jury</div>
        </div>

        {favoriteCounts.length === 0 ? (
          <div className="info-banner banner-amber">
            <span className="banner-icon">⏳</span>
            Aucun coup de cœur n'a encore été attribué.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "1rem",
            }}
          >
            {favoriteCounts.map((fav, idx) => (
              <div
                key={idx}
                className="card"
                style={{ padding: 0, overflow: "hidden", cursor: "pointer" }}
                onClick={() =>
                  setExpandedFav(
                    expandedFav?.submissionId === fav.submissionId ? null : fav,
                  )
                }
              >
                {/* Photo */}
                <div style={{ position: "relative", height: "180px" }}>
                  {fav.photoUrl ? (
                    <img
                      src={fav.photoUrl}
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
                        background: "var(--sand-dark)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "2rem",
                      }}
                    >
                      📷
                    </div>
                  )}
                  {/* Badge nb coups de cœur */}
                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      background: "rgba(0,0,0,.65)",
                      borderRadius: "999px",
                      padding: "3px 10px",
                      color: "#fff",
                      fontSize: ".75rem",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    ❤️ {fav.voteCount}
                  </div>
                </div>

                {/* Infos */}
                <div style={{ padding: ".75rem 1rem" }}>
                  <div style={{ fontWeight: 700, fontSize: ".9rem" }}>
                    {fav.anonymousId}
                  </div>
                  <div
                    style={{
                      fontSize: ".8rem",
                      color: "var(--ink-muted)",
                      marginTop: ".15rem",
                    }}
                  >
                    📸 {fav.author}
                  </div>
                  {fav.categoryName && (
                    <div
                      style={{
                        fontSize: ".7rem",
                        color: "var(--ink-faint)",
                        marginTop: ".1rem",
                      }}
                    >
                      {fav.categoryName}
                    </div>
                  )}

                  {/* Détail des jurés — affiché au clic */}
                  {expandedFav?.submissionId === fav.submissionId &&
                    fav.jurorVotes?.length > 0 && (
                      <div
                        style={{
                          marginTop: ".6rem",
                          paddingTop: ".6rem",
                          borderTop: "1px solid var(--sand-border)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: ".7rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            color: "var(--ink-faint)",
                            marginBottom: ".35rem",
                          }}
                        >
                          Votes des jurés
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: ".25rem",
                          }}
                        >
                          {fav.jurorVotes.map((v, vi) => (
                            <div
                              key={vi}
                              style={{
                                fontSize: ".75rem",
                                color: "var(--ink-muted)",
                                display: "flex",
                                alignItems: "center",
                                gap: ".35rem",
                              }}
                            >
                              <span style={{ color: "var(--amber)" }}>❤️</span>
                              {v.jurorName}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 5. Prix de l'œil (jurés seulement) ──────────────────── */}
      {isJuror && (
        <div className="section">
          <div className="section-header">
            <div className="section-title">
              👁️ Prix de l'œil — Photo la plus originale
            </div>
          </div>

          {/* Résultat finalisé */}
          {finalResult ? (
            <div className="card" style={{ textAlign: "center" }}>
              {finalResult.submissions?.photoUrl && (
                <img
                  src={finalResult.submissions.photoUrl}
                  alt="Photo gagnante"
                  style={{
                    width: "100%",
                    maxHeight: 320,
                    objectFit: "contain",
                    borderRadius: 8,
                    marginBottom: "1rem",
                    background: "#000",
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
                {finalResult.submissions?.anonymous_id}
              </div>
              <div
                style={{
                  fontSize: ".8rem",
                  color: "var(--ink-muted)",
                  marginTop: ".25rem",
                }}
              >
                {finalResult.submissions?.users &&
                  `par ${finalResult.submissions.users.first_name} ${finalResult.submissions.users.last_name}`}
                {finalResult.submissions?.categories?.name &&
                  ` · ${finalResult.submissions.categories.name}`}
              </div>
              <div className="badge badge-amber" style={{ marginTop: ".5rem" }}>
                {finalResult.total_votes} vote(s)
              </div>
            </div>
          ) : (
            <>
              {/* Bandeau statut de mon vote */}
              <div
                className="info-banner banner-amber"
                style={{ marginBottom: "1rem" }}
              >
                <span className="banner-icon">🗳️</span>
                {hasVoted ? (
                  <span>
                    Vous avez voté pour{" "}
                    <strong>
                      {eyePrizeData?.myVote?.submissions?.anonymous_id}
                    </strong>
                    . Vous pouvez modifier votre vote.
                  </span>
                ) : (
                  <span>
                    Vous n'avez pas encore voté. Choisissez la photo la plus
                    originale !
                  </span>
                )}
              </div>

              {/* Bouton voter */}
              <button
                className="btn btn-primary btn-full"
                onClick={() => setShowVoteModal(true)}
                style={{ marginBottom: "1rem" }}
              >
                {hasVoted
                  ? "🔄 Modifier mon vote"
                  : "🗳️ Voter pour ma photo préférée"}
              </button>

              {/* Résumé des votes actuels */}
              {voteCounts.length > 0 && (
                <div className="panel">
                  <div
                    className="section-header"
                    style={{
                      padding: ".75rem 1rem",
                      borderBottom: "1px solid var(--sand-border)",
                    }}
                  >
                    <div className="section-title">
                      📊 Votes actuels (
                      {eyePrizeData?.jurorsWhoVoted?.length || 0} /{" "}
                      {eyePrizeData?.totalJurors || 0} jurés)
                    </div>
                    {user?.role === "admin" && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setShowResultsModal(true)}
                      >
                        🏆 Finaliser
                      </button>
                    )}
                  </div>

                  {hasTie && (
                    <div
                      className="info-banner banner-red"
                      style={{ margin: ".75rem 1rem 0" }}
                    >
                      <span className="banner-icon">⚠️</span>
                      Égalité détectée ! Le jury doit délibérer.
                    </div>
                  )}

                  <div style={{ padding: ".75rem" }}>
                    {voteCounts.slice(0, 5).map((vote, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: ".75rem",
                          padding: ".5rem",
                          borderRadius: "8px",
                          marginBottom: ".4rem",
                          background:
                            idx === 0
                              ? "rgba(var(--amber-rgb),.08)"
                              : "transparent",
                        }}
                      >
                        {vote.photoUrl ? (
                          <img
                            src={vote.photoUrl}
                            alt=""
                            style={{
                              width: "52px",
                              height: "52px",
                              objectFit: "cover",
                              borderRadius: "6px",
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "52px",
                              height: "52px",
                              background: "var(--sand-dark)",
                              borderRadius: "6px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            📷
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: ".85rem" }}>
                            {vote.anonymousId}
                          </div>
                          <div
                            style={{
                              fontSize: ".72rem",
                              color: "var(--ink-muted)",
                            }}
                          >
                            {vote.author}
                          </div>
                          <div
                            style={{
                              fontSize: ".68rem",
                              color: "var(--ink-faint)",
                            }}
                          >
                            {vote.categoryName}
                          </div>
                        </div>
                        <span
                          className="badge badge-amber"
                          style={{ flexShrink: 0, fontWeight: 700 }}
                        >
                          {vote.votes} voix
                        </span>
                      </div>
                    ))}
                    {voteCounts.length > 5 && (
                      <button
                        className="btn btn-sm btn-full"
                        style={{ marginTop: ".5rem" }}
                        onClick={() => setShowResultsModal(true)}
                      >
                        Voir tous les votes ({voteCounts.length})
                      </button>
                    )}
                  </div>

                  {/* Jurés n'ayant pas encore voté */}
                  {eyePrizeData?.jurorsMissing?.length > 0 && (
                    <div
                      style={{
                        padding: ".5rem 1rem .75rem",
                        fontSize: ".72rem",
                        color: "var(--ink-faint)",
                        borderTop: "1px solid var(--sand-border)",
                      }}
                    >
                      En attente :{" "}
                      {eyePrizeData.jurorsMissing
                        .map((j) => j.first_name)
                        .join(", ")}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODAL — Voter pour le Prix de l'œil
      ════════════════════════════════════════════════════════ */}
      {showVoteModal && (
        <div className="modal-backdrop" onClick={() => setShowVoteModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: "760px", maxHeight: "85dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>👁️ Choisissez la photo la plus originale</h3>
              <button
                className="btn btn-sm"
                onClick={() => setShowVoteModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto" }}>
              {selectedPhoto && (
                <div
                  className="info-banner banner-amber"
                  style={{ marginBottom: "1rem" }}
                >
                  <span className="banner-icon">✔️</span>
                  Sélectionnée : <strong>{selectedPhoto.anonymous_id}</strong> —
                  confirmez ci-dessous.
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: ".5rem",
                }}
              >
                {(data?.allSubmissions || []).map((sub) => {
                  const isMyCurrent =
                    eyePrizeData?.myVote?.submission_id === sub.id;
                  const isSelected = selectedPhoto?.id === sub.id;
                  return (
                    <div
                      key={sub.id}
                      onClick={() => setSelectedPhoto(isSelected ? null : sub)}
                      style={{
                        cursor: "pointer",
                        borderRadius: "8px",
                        overflow: "hidden",
                        border: isSelected
                          ? "3px solid var(--amber)"
                          : isMyCurrent
                            ? "3px solid var(--green, #4ade80)"
                            : "2px solid var(--sand-border)",
                        position: "relative",
                        aspectRatio: "1",
                        background: "var(--sand-dark)",
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
                            display: "block",
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
                            fontSize: "1.5rem",
                          }}
                        >
                          📷
                        </div>
                      )}
                      {/* Overlay avec l'identifiant */}
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          background:
                            "linear-gradient(to top, rgba(0,0,0,.75), transparent)",
                          padding: "1.5rem .4rem .35rem",
                          color: "#fff",
                          fontSize: ".65rem",
                          fontWeight: 700,
                          textAlign: "center",
                        }}
                      >
                        {sub.anonymous_id}
                      </div>
                      {/* Indicateur vote actuel */}
                      {isMyCurrent && (
                        <div
                          style={{
                            position: "absolute",
                            top: "5px",
                            right: "5px",
                            background: "var(--green, #22c55e)",
                            borderRadius: "50%",
                            width: "20px",
                            height: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: ".6rem",
                          }}
                        >
                          ✓
                        </div>
                      )}
                      {/* Indicateur sélection en cours */}
                      {isSelected && (
                        <div
                          style={{
                            position: "absolute",
                            top: "5px",
                            left: "5px",
                            background: "var(--amber)",
                            borderRadius: "50%",
                            width: "20px",
                            height: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: ".6rem",
                            color: "#fff",
                          }}
                        >
                          ★
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn"
                onClick={() => {
                  setShowVoteModal(false);
                  setSelectedPhoto(null);
                }}
              >
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={() => selectedPhoto && handleVote(selectedPhoto.id)}
                disabled={!selectedPhoto || voting}
              >
                {voting ? "⏳ Enregistrement…" : "✅ Confirmer mon vote"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODAL — Résultats complets + finalisation (admin)
      ════════════════════════════════════════════════════════ */}
      {showResultsModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowResultsModal(false)}
        >
          <div
            className="modal"
            style={{ maxWidth: "600px", maxHeight: "85dvh" }}
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
              {hasTie && (
                <div
                  className="info-banner banner-red"
                  style={{ marginBottom: "1rem" }}
                >
                  <span className="banner-icon">⚠️</span>
                  Égalité détectée ! Le jury doit délibérer et choisir la photo
                  gagnante.
                </div>
              )}
              {voteCounts.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "var(--ink-muted)",
                  }}
                >
                  Aucun vote enregistré.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: ".5rem",
                  }}
                >
                  {[...voteCounts]
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
                          background:
                            idx === 0
                              ? "rgba(var(--amber-rgb),.07)"
                              : undefined,
                        }}
                      >
                        {vote.photoUrl ? (
                          <img
                            src={vote.photoUrl}
                            alt=""
                            style={{
                              width: "64px",
                              height: "64px",
                              objectFit: "cover",
                              borderRadius: "8px",
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "64px",
                              height: "64px",
                              background: "var(--sand-dark)",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            📷
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700 }}>
                            {vote.anonymousId}
                          </div>
                          <div
                            style={{
                              fontSize: ".75rem",
                              color: "var(--ink-muted)",
                            }}
                          >
                            {vote.author}
                          </div>
                          <div
                            style={{
                              fontSize: ".7rem",
                              color: "var(--ink-faint)",
                            }}
                          >
                            {vote.categoryName}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: ".4rem",
                          }}
                        >
                          <span
                            className="badge badge-amber"
                            style={{ fontSize: "1rem", padding: ".3rem 1rem" }}
                          >
                            {vote.votes} voix
                          </span>
                          {user?.role === "admin" && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => handleFinalize(vote.submissionId)}
                              disabled={finalizing}
                            >
                              🏆 Finaliser
                            </button>
                          )}
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

      {/* ════════════════════════════════════════════════════════
          MODAL — Égalité : délibération du jury
      ════════════════════════════════════════════════════════ */}
      {showTieModal && (
        <div className="modal-backdrop" onClick={() => setShowTieModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: "620px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>⚠️ Égalité — Délibération du jury</h3>
              <button
                className="btn btn-sm"
                onClick={() => setShowTieModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: "1rem", color: "var(--ink-muted)" }}>
                Plusieurs photos ont le même nombre de votes. Le jury doit
                délibérer et choisir la photo gagnante.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "1rem",
                }}
              >
                {tieSubmissions.map((sub, idx) => (
                  <div
                    key={idx}
                    className="card"
                    style={{ textAlign: "center", padding: "1rem" }}
                  >
                    {sub.photoUrl ? (
                      <img
                        src={sub.photoUrl}
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
                          fontSize: "2rem",
                        }}
                      >
                        📷
                      </div>
                    )}
                    <div style={{ fontWeight: 700 }}>{sub.anonymous_id}</div>
                    <div
                      style={{
                        fontSize: ".75rem",
                        color: "var(--ink-muted)",
                        marginTop: ".2rem",
                      }}
                    >
                      {sub.users?.first_name} {sub.users?.last_name}
                    </div>
                    <div
                      className="badge badge-amber"
                      style={{ margin: ".5rem 0" }}
                    >
                      {sub.votes} voix
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ width: "100%" }}
                      onClick={() => handleFinalize(sub.id)}
                      disabled={finalizing}
                    >
                      🏆 Choisir cette photo
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowTieModal(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
