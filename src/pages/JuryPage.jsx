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
// COMPOSANT PALMARÈS - Version avec coups de cœur détaillés + Prix de l'œil avec gestion égalité
// ════════════════════════════════════════════════════════════════
function PalmaresView({ showFlash, user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showTieModal, setShowTieModal] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [voting, setVoting] = useState(false);
  const [eyePrizeData, setEyePrizeData] = useState(null);
  const [tieSubmissions, setTieSubmissions] = useState([]);
  const [finalizing, setFinalizing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [palmaresResult, votesResult] = await Promise.all([
        api.get("/results/palmares"),
        api.get("/results/eye-prize/votes").catch(() => null),
      ]);
      setData(palmaresResult);
      setEyePrizeData(votesResult);
    } catch (e) {
      console.error(e);
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
        showFlash("⚠️ Égalité détectée ! Le jury doit délibérer.");
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

  const isJuror = user?.role === "juror" || user?.role === "admin";
  const hasVoted = eyePrizeData?.myVote !== null;
  const voteCounts = eyePrizeData?.voteCounts || [];
  const finalResult = eyePrizeData?.finalResult;
  const hasTie = eyePrizeData?.hasTie;

  // Pour l'affichage des coups de cœur avec photos
  const favoriteCounts = data?.favoriteCounts || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Photo d'Or */}
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

      {/* 2. Classement général */}
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

      {/* 3. Prix par catégorie */}
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

      {/* 4. Coup de cœur du jury - AVEC PHOTOS et DÉTAILS */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">❤️ Coup de cœur du jury</div>
        </div>
        {favoriteCounts.length > 0 ? (
          <div
            className="photo-grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
            }}
          >
            {favoriteCounts.map((fav, idx) => (
              <div
                key={idx}
                className="card"
                style={{ textAlign: "center", padding: "1rem" }}
              >
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
                    }}
                  >
                    📷
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: ".9rem" }}>
                  {fav.anonymousId}
                </div>
                <div
                  style={{
                    fontSize: ".75rem",
                    color: "var(--ink-muted)",
                    marginTop: ".25rem",
                  }}
                >
                  📸 {fav.author}
                </div>
                {fav.categoryName && (
                  <div
                    style={{
                      fontSize: ".7rem",
                      color: "var(--ink-faint)",
                      marginTop: ".2rem",
                    }}
                  >
                    {fav.categoryName}
                  </div>
                )}
                <div
                  className="badge badge-amber"
                  style={{ marginTop: ".75rem" }}
                >
                  ❤️ {fav.voteCount} coup(s) de cœur
                </div>
                {fav.jurorVotes && fav.jurorVotes.length > 0 && (
                  <div
                    style={{
                      fontSize: ".65rem",
                      color: "var(--ink-muted)",
                      marginTop: ".5rem",
                    }}
                  >
                    Votes :{" "}
                    {fav.jurorVotes
                      .map((v) => v.jurorName.split(" ")[0])
                      .join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="info-banner banner-amber">
            <span className="banner-icon">⏳</span>Aucun coup de cœur n'a encore
            été attribué.
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

        {finalResult ? (
          <div className="card" style={{ textAlign: "center" }}>
            {finalResult.submissions?.photoUrl && (
              <img
                src={finalResult.submissions.photoUrl}
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
              {finalResult.submissions?.anonymous_id}
            </div>
            <div style={{ fontSize: ".8rem", color: "var(--ink-muted)" }}>
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
            {voteCounts.length > 0 && (
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
                      "repeat(auto-fill, minmax(180px, 1fr))",
                  }}
                >
                  {voteCounts.slice(0, 3).map((vote, idx) => (
                    <div
                      key={idx}
                      className="card"
                      style={{ textAlign: "center", padding: ".75rem" }}
                    >
                      {vote.photoUrl ? (
                        <img
                          src={vote.photoUrl}
                          alt=""
                          style={{
                            width: "100%",
                            height: "120px",
                            objectFit: "cover",
                            borderRadius: "6px",
                            marginBottom: ".5rem",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "120px",
                            background: "var(--sand-dark)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "6px",
                            marginBottom: ".5rem",
                          }}
                        >
                          📷
                        </div>
                      )}
                      <div style={{ fontSize: ".75rem", fontWeight: 600 }}>
                        {vote.anonymousId}
                      </div>
                      <span
                        className="badge badge-amber"
                        style={{ fontSize: ".7rem", marginTop: ".25rem" }}
                      >
                        {vote.votes} voix
                      </span>
                    </div>
                  ))}
                </div>
                {hasTie && (
                  <div
                    className="info-banner banner-red"
                    style={{ marginTop: ".5rem" }}
                  >
                    <span className="banner-icon">⚠️</span>Égalité détectée !
                    Cliquez sur "Voir tous les votes" pour départager.
                  </div>
                )}
              </div>
            )}

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
                  Vous n'avez pas encore voté. Sélectionnez votre photo préférée
                  !
                </span>
              )}
            </div>

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

      {/* MODAL DE VOTE */}
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
                {(data?.allSubmissions || []).map((sub) => (
                  <div
                    key={sub.id}
                    className={`photo-item ${eyePrizeData?.myVote?.submission_id === sub.id ? "selected" : ""}`}
                    onClick={() => setSelectedPhoto(sub)}
                    style={{
                      cursor: "pointer",
                      border:
                        eyePrizeData?.myVote?.submission_id === sub.id
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
                        {sub.anonymous_id}
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
                  className="photo-grid"
                  style={{ gridTemplateColumns: "1fr" }}
                >
                  {voteCounts
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
                        <div>
                          <span
                            className="badge badge-amber"
                            style={{ fontSize: "1rem", padding: ".3rem 1rem" }}
                          >
                            {vote.votes} voix
                          </span>
                        </div>
                        {isJuror && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleFinalize(vote.submissionId)}
                            disabled={finalizing}
                          >
                            🏆 Finaliser
                          </button>
                        )}
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

      {/* MODAL D'ÉGALITÉ - Demande de délibération */}
      {showTieModal && (
        <div className="modal-backdrop" onClick={() => setShowTieModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: "600px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>⚠️ Égalité détectée</h3>
              <button
                className="btn btn-sm"
                onClick={() => setShowTieModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Plusieurs photos ont le même nombre de votes. Le jury doit
                délibérer pour choisir la gagnante.
              </p>
              <div
                className="photo-grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  marginTop: "1rem",
                }}
              >
                {tieSubmissions.map((sub, idx) => (
                  <div
                    key={idx}
                    className="card"
                    style={{
                      textAlign: "center",
                      padding: "1rem",
                      cursor: "pointer",
                    }}
                    onClick={() => handleFinalize(sub.id)}
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
                        }}
                      >
                        📷
                      </div>
                    )}
                    <div style={{ fontWeight: 700 }}>{sub.anonymous_id}</div>
                    <div
                      style={{ fontSize: ".75rem", color: "var(--ink-muted)" }}
                    >
                      {sub.users?.first_name} {sub.users?.last_name}
                    </div>
                    <div
                      className="badge badge-amber"
                      style={{ marginTop: ".5rem" }}
                    >
                      {sub.votes} voix
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: ".5rem", width: "100%" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFinalize(sub.id);
                      }}
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
