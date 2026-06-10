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
  const [scores, setScores] = useState({}); // { criterionId: value }
  const [validated, setValidated] = useState(false);
  const [validations, setValidations] = useState([]);
  const [flash, setFlash] = useState("");
  const [slideshowMode, setSlideshowMode] = useState(false);

  const TABS = [
    { id: "notation", label: "Notation", icon: "📋" },
    { id: "palmares", label: "Palmarès", icon: "🏆" },
  ];

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }

  // Dans JuryPage.jsx, remplacez la fonction loadSessions par :

  // Dans JuryPage.jsx, modifiez la fonction loadSessions :

  const loadSessions = useCallback(async () => {
    try {
      const [sess, crit] = await Promise.all([
        api.get("/deliberations/active"),
        api.get("/criteria"), // ← CHANGÉ : plus /admin/criteria
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

  // Charge la photo courante + mes scores quand la session active change
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

      // Initialiser les scores
      const scoreMap = {};
      (myScores || []).forEach((s) => {
        scoreMap[s.criterion_id] = s.value;
      });
      setScores(scoreMap);

      // Vérifier si déjà validé
      const myVal = vals.validations?.find((v) => v.jurorId === user.id);
      setValidated(!!myVal?.validated);
      setValidations(vals.validations || []);
    } catch (e) {
      console.error(e);
    }
  }

  // Realtime : écoute les validations + changements de photo
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
            {activeSession && (
              <button
                className="btn btn-sm"
                style={{
                  borderColor: "rgba(255,255,255,.25)",
                  color: "var(--sand)",
                  background: "transparent",
                }}
                onClick={() => setSlideshowMode(true)}
              >
                📽️ Diapo
              </button>
            )}
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

      <div className="page">
        {tab === "notation" && (
          <>
            {/* Sélection de la catégorie */}
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
                {sessions.filter((s) => s.status === "open").length === 0 && (
                  <div
                    className="info-banner banner-amber"
                    style={{ width: "100%" }}
                  >
                    <span className="banner-icon">⏳</span>
                    Aucune délibération en cours. L'administrateur doit ouvrir
                    une catégorie.
                  </div>
                )}
              </div>
            </div>

            {/* Notation */}
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

                  {/* Photo */}
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

                  {/* Critères */}
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
                          <span className="score-max">/ {c.max_points}</span>
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

                {/* Indicateur de validation temps réel */}
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">État des validations</div>
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

        {tab === "palmares" && <PalmaresView />}
      </div>

      {flash && <div className="flash">{flash}</div>}
    </>
  );
}

function PalmaresView() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api
      .get("/results/palmares")
      .then(setData)
      .catch(() => {});
  }, []);
  if (!data)
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  return (
    <div className="section">
      <div className="section-header">
        <div className="section-title">Palmarès provisoire</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
        {data.generalRanking?.map((p, i) => (
          <div
            key={i}
            className="panel"
            style={{
              padding: ".75rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}
          >
            <span style={{ fontSize: i < 3 ? "1.4rem" : "1rem" }}>
              {["🥇", "🥈", "🥉"][i] || `${i + 1}.`}
            </span>
            <div style={{ flex: 1, fontWeight: 600 }}>{p.name}</div>
            <span className="badge badge-amber">{p.total?.toFixed(1)} pts</span>
          </div>
        ))}
      </div>
    </div>
  );
}
