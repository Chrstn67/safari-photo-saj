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
          loadCurrentPhoto(open.category_id, open.current_photo.id);
        }
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
    }
  }

  useEffect(() => {
    if (!activeSession) return;
    const unsub1 = subscribe("jury_validations", "*", () => {
      api
        .get(`/deliberations/${activeSession.category_id}/validations`)
        .then((v) => setValidations(v.validations || []));
    });
    const unsub2 = subscribe("deliberation_sessions", "UPDATE", (payload) => {
      if (payload.new.category_id === activeSession.category_id) {
        setSessions((prev) =>
          prev.map((s) =>
            s.category_id === activeSession.category_id
              ? { ...s, ...payload.new }
              : s,
          ),
        );
        setActiveSession((prev) => ({ ...prev, ...payload.new }));
        if (payload.new.current_photo_id !== activeSession.current_photo?.id) {
          setValidated(false);
          setScores({});
        }
      }
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [activeSession?.category_id]);

  async function handleScoreChange(criterionId, value) {
    if (validated) return;
    const v = Math.max(
      0,
      Math.min(
        criteria.find((c) => c.id === criterionId)?.max_points || 5,
        parseFloat(value) || 0,
      ),
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
        setTimeout(() => {
          api
            .post("/deliberations/next", {
              categoryId: activeSession.category_id,
            })
            .then(loadSessions);
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

      {/* Menu latéral pour desktop + mobile overlay */}
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
                          onClick={() => setActiveSession(s)}
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
                        {currentPhoto.url ? (
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

      {/* Mobile bottom nav - caché en desktop via CSS */}
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

/* ── Composant Palmarès complet avec toutes les récompenses ── */
function PalmaresView({ showFlash, user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectingEyePrize, setSelectingEyePrize] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await api.get("/results/palmares");
      setData(result);
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

  const handleSelectEyePrize = async (submissionId) => {
    try {
      await api.post("/results/select-eye-prize", { submissionId });
      showFlash("✅ Prix de l'œil attribué !");
      await loadData();
      setSelectingEyePrize(false);
    } catch (e) {
      showFlash("❌ " + e.message);
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
  const canSelectEyePrize = isJuror && !data.eyePrize;

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
          {Object.entries(
            (data.byCategory || []).reduce((acc, r) => {
              if (!acc[r.category_id]) acc[r.category_id] = [];
              acc[r.category_id].push(r);
              return acc;
            }, {}),
          ).map(([catId, results]) => {
            const winner = results[0];
            const categoryName =
              winner.categories?.name || `Catégorie ${catId}`;
            return (
              <div key={catId} className="card">
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
            );
          })}
        </div>
      </div>

      {/* 4. Coup de cœur du jury */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">❤️ Coup de cœur du jury</div>
        </div>
        {data.topFavorite ? (
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: ".5rem" }}>❤️</div>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: "1.2rem",
                color: "var(--red)",
              }}
            >
              {data.topFavorite.anonymousId}
            </div>
            <div style={{ fontSize: ".8rem", color: "var(--ink-muted)" }}>
              {data.topFavorite.author && `par ${data.topFavorite.author}`}
              {data.topFavorite.categoryName &&
                ` · ${data.topFavorite.categoryName}`}
            </div>
            <div className="badge badge-amber" style={{ marginTop: ".5rem" }}>
              {data.topFavorite.totalFavorites} coup(s) de cœur
            </div>
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
        {data.eyePrize ? (
          <div className="card" style={{ textAlign: "center" }}>
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
              {data.eyePrize.submissions?.anonymous_id}
            </div>
            <div style={{ fontSize: ".8rem", color: "var(--ink-muted)" }}>
              {data.eyePrize.submissions?.users &&
                `par ${data.eyePrize.submissions.users.first_name} ${data.eyePrize.submissions.users.last_name}`}
              {data.eyePrize.submissions?.categories?.name &&
                ` · ${data.eyePrize.submissions.categories.name}`}
            </div>
          </div>
        ) : canSelectEyePrize ? (
          selectingEyePrize ? (
            <div className="panel">
              <div className="section-header">
                <div className="section-title">
                  Sélectionner la photo gagnante
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => setSelectingEyePrize(false)}
                >
                  ✕
                </button>
              </div>
              <div
                className="photo-grid"
                style={{ maxHeight: "400px", overflowY: "auto" }}
              >
                {(data.allSubmissions || []).map((sub) => (
                  <div
                    key={sub.id}
                    className="photo-item"
                    onClick={() => handleSelectEyePrize(sub.id)}
                    style={{ cursor: "pointer" }}
                  >
                    {sub.photos?.storage_path && (
                      <img
                        src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/photos/${sub.photos.storage_path}`}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
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
          ) : (
            <button
              className="btn btn-primary btn-full"
              onClick={() => setSelectingEyePrize(true)}
            >
              👁️ Sélectionner la photo la plus originale
            </button>
          )
        ) : (
          <div className="info-banner banner-amber">
            <span className="banner-icon">⏳</span>
            Le Prix de l'œil sera annoncé prochainement.
          </div>
        )}
      </div>
    </div>
  );
}
