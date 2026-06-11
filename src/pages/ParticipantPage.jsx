// frontend/src/pages/ParticipantPage.jsx
import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../server/hooks/useAuth.jsx";
import { api } from "../../server/utils/api.js";
import TopBar from "../components/TopBar.jsx";

export default function ParticipantPage() {
  const { user, logout } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tab, setTab] = useState("bank");
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState("");
  const [submitModal, setSubmitModal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [resultsPublished, setResultsPublished] = useState(false);
  const fileRef = useRef();

  const TABS = [
    { id: "bank", label: "Ma banque", icon: "🖼️" },
    { id: "submit", label: "Soumettre", icon: "📤" },
    { id: "results", label: "Résultats", icon: "🏆" },
  ];

  useEffect(() => {
    load();
    checkResultsStatus();
  }, []);

  async function load() {
    try {
      const [p, c] = await Promise.all([
        api.get("/photos"),
        api.get("/categories"),
      ]);
      setPhotos(p);
      setCategories(c);
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function checkResultsStatus() {
    try {
      const status = await api.get("/results/status");
      setResultsPublished(status.isPublished === true);
    } catch (e) {
      console.error("Erreur vérification statut résultats:", e);
    }
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const photo = await api.upload("/photos", form);
      setPhotos((prev) => [photo, ...prev]);
      showFlash("✅ Photo ajoutée à ta banque");
    } catch (err) {
      showFlash("❌ " + err.message);
    } finally {
      setUploading(false);
      fileRef.current.value = "";
    }
  }

  async function handleDelete(photo) {
    if (!confirm(`Supprimer cette photo ?`)) return;
    try {
      await api.delete(`/photos/${photo.id}`);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      showFlash("🗑️ Photo supprimée");
    } catch (err) {
      showFlash("❌ " + err.message);
    }
  }

  async function handleSubmit(photo, categoryId) {
    try {
      await api.post(`/photos/${photo.id}/submit`, { categoryId });
      setSubmitModal(null);
      showFlash("✅ Photo soumise au concours !");
      load();
    } catch (err) {
      showFlash("❌ " + err.message);
    }
  }

  // Vérifier si une catégorie a déjà une soumission
  const hasSubmissionInCategory = (categoryId) => {
    return photos.some(
      (p) => p.is_submitted && p.category_submissions?.includes(categoryId),
    );
  };

  return (
    <>
      <TopBar
        title={
          <>
            📸 Safari · <span>Participant</span>
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

      {/* Layout avec menu latéral */}
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
          <div className="side-info">
            <div className="side-info-label">Mon compte</div>
            <div className="side-info-value">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="side-info-label" style={{ marginTop: "1rem" }}>
              Rôle
            </div>
            <div
              className="side-info-value"
              style={{ fontSize: ".8rem", color: "var(--amber)" }}
            >
              Participant
            </div>
          </div>
        </div>

        <div className="main-content">
          <div className="page">
            {/* ── BANQUE ── */}
            {tab === "bank" && (
              <div className="section">
                <div className="section-header">
                  <div className="section-title">Ma banque de photos</div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => fileRef.current.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <span
                        className="spinner"
                        style={{ width: 14, height: 14 }}
                      />
                    ) : (
                      "+ Ajouter"
                    )}
                  </button>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.heic,.raw"
                  style={{ display: "none" }}
                  onChange={handleUpload}
                />

                {photos.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📷</div>
                    <div className="empty-title">Aucune photo</div>
                    <p>Importe tes photos depuis ta galerie.</p>
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: "1rem" }}
                      onClick={() => fileRef.current.click()}
                    >
                      + Importer une photo
                    </button>
                  </div>
                ) : (
                  <div className="photo-grid">
                    {photos.map((photo) => (
                      <div
                        key={photo.id}
                        className="photo-item"
                        onClick={() => setPreview(photo)}
                      >
                        {photo.url && (
                          <img src={photo.url} alt="" loading="lazy" />
                        )}
                        {!photo.url && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: "100%",
                              color: "var(--ink-faint)",
                              fontSize: "2rem",
                            }}
                          >
                            📷
                          </div>
                        )}
                        {photo.is_submitted && (
                          <span className="photo-submitted">Soumise</span>
                        )}
                        <div className="photo-overlay">
                          {!photo.is_submitted && (
                            <>
                              <button
                                className="photo-action"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSubmitModal(photo);
                                }}
                              >
                                📤 Soumettre
                              </button>
                              <button
                                className="photo-action"
                                style={{ color: "var(--red)" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(photo);
                                }}
                              >
                                🗑️
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── SOUMETTRE ── */}
            {tab === "submit" && (
              <div className="section">
                <div className="section-header">
                  <div className="section-title">Soumettre une photo</div>
                </div>
                <div
                  className="info-banner banner-amber"
                  style={{ marginBottom: "1rem" }}
                >
                  <span className="banner-icon">⚠️</span>
                  Une seule photo par catégorie. Une fois soumise, elle ne peut
                  plus être modifiée.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: ".75rem",
                  }}
                >
                  {categories.map((cat) => {
                    const alreadySubmitted = hasSubmissionInCategory(cat.id);
                    const myPhotos = photos.filter((p) => !p.is_submitted);
                    return (
                      <div
                        key={cat.id}
                        className="panel"
                        style={{ padding: "1rem" }}
                      >
                        <div
                          style={{ fontWeight: 700, marginBottom: ".35rem" }}
                        >
                          {cat.name}
                        </div>
                        <div
                          style={{
                            fontSize: ".8rem",
                            color: "var(--ink-muted)",
                            marginBottom: ".75rem",
                          }}
                        >
                          {cat.description}
                        </div>
                        {alreadySubmitted ? (
                          <div
                            className="info-banner banner-green"
                            style={{ margin: 0 }}
                          >
                            <span className="banner-icon">✅</span>
                            Vous avez déjà soumis une photo dans cette
                            catégorie.
                          </div>
                        ) : myPhotos.length === 0 ? (
                          <p
                            style={{
                              fontSize: ".78rem",
                              color: "var(--ink-faint)",
                            }}
                          >
                            Aucune photo disponible — ajoutez-en dans votre
                            banque.
                          </p>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              gap: ".5rem",
                              flexWrap: "wrap",
                            }}
                          >
                            {myPhotos.slice(0, 6).map((p) => (
                              <div
                                key={p.id}
                                onClick={() => handleSubmit(p, cat.id)}
                                style={{
                                  width: 64,
                                  height: 64,
                                  borderRadius: 8,
                                  overflow: "hidden",
                                  border: "2px solid var(--sand-border)",
                                  cursor: "pointer",
                                  transition: "border-color .15s",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.borderColor =
                                    "var(--amber)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.borderColor =
                                    "var(--sand-border)")
                                }
                              >
                                {p.url && (
                                  <img
                                    src={p.url}
                                    alt=""
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── RÉSULTATS ── */}
            {tab === "results" && (
              <ParticipantResultsPanel
                resultsPublished={resultsPublished}
                showFlash={showFlash}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom nav mobile */}
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

      {/* ── MODAL SOUMISSION ── */}
      {submitModal && (
        <div className="modal-backdrop" onClick={() => setSubmitModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Choisir une catégorie</h3>
              <button
                className="btn btn-sm"
                onClick={() => setSubmitModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {submitModal.url && (
                <img
                  src={submitModal.url}
                  alt=""
                  style={{
                    width: "100%",
                    height: 180,
                    objectFit: "cover",
                    borderRadius: 8,
                    marginBottom: "1rem",
                  }}
                />
              )}
              <p
                style={{
                  fontSize: ".84rem",
                  color: "var(--ink-muted)",
                  marginBottom: "1rem",
                }}
              >
                Dans quelle catégorie soumettre cette photo ?
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: ".5rem",
                }}
              >
                {categories.map((cat) => {
                  const alreadySubmitted = hasSubmissionInCategory(cat.id);
                  return (
                    <button
                      key={cat.id}
                      className={`btn btn-full ${alreadySubmitted ? "disabled" : ""}`}
                      style={{
                        justifyContent: "flex-start",
                        opacity: alreadySubmitted ? 0.5 : 1,
                        cursor: alreadySubmitted ? "not-allowed" : "pointer",
                      }}
                      onClick={() =>
                        !alreadySubmitted && handleSubmit(submitModal, cat.id)
                      }
                      disabled={alreadySubmitted}
                    >
                      {cat.name} {alreadySubmitted && "(déjà soumise)"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PREVIEW ── */}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div
            style={{ maxWidth: 700, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            {preview.url && (
              <img
                src={preview.url}
                alt=""
                style={{
                  width: "100%",
                  borderRadius: 12,
                  maxHeight: "80dvh",
                  objectFit: "contain",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: ".5rem",
                marginTop: "1rem",
              }}
            >
              {!preview.is_submitted && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setSubmitModal(preview);
                      setPreview(null);
                    }}
                  >
                    📤 Soumettre
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      handleDelete(preview);
                      setPreview(null);
                    }}
                  >
                    🗑️ Supprimer
                  </button>
                </>
              )}
              <button className="btn" onClick={() => setPreview(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {flash && <div className="flash">{flash}</div>}
    </>
  );
}

/* ── PANEL DES RÉSULTATS POUR PARTICIPANT ── */
function ParticipantResultsPanel({ resultsPublished, showFlash }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (resultsPublished) {
      loadResults();
    } else {
      setLoading(false);
    }
  }, [resultsPublished]);

  async function loadResults() {
    setLoading(true);
    try {
      const result = await api.get("/results/palmares");
      console.log("[Participant] Résultats reçus:", result);
      setData(result);
      setError("");
    } catch (e) {
      console.error("[Participant] Erreur:", e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!resultsPublished) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🔒</div>
        <div className="empty-title">Résultats non disponibles</div>
        <p>Les résultats seront publiés après la cérémonie.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">❌</div>
        <div className="empty-title">Erreur</div>
        <p>{error}</p>
      </div>
    );
  }

  if (!data || !data.generalRanking?.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🏆</div>
        <div className="empty-title">En attente des résultats</div>
        <p>Les résultats seront affichés ici prochainement.</p>
      </div>
    );
  }

  // Trouver le score du participant connecté
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const myScore = data.generalRanking.find((p) =>
    p.name.toLowerCase().includes(currentUser.firstName?.toLowerCase() || ""),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Bandeau avec mon score */}
      {myScore && (
        <div
          className="info-banner banner-green"
          style={{ textAlign: "center", justifyContent: "center" }}
        >
          <span className="banner-icon">🏅</span>
          <span>
            <strong>Mon classement :</strong>{" "}
            {data.generalRanking.findIndex((p) => p.name === myScore.name) + 1}e
            place ·{myScore.total.toFixed(1)} points · {myScore.finalists}{" "}
            podium(s)
          </span>
        </div>
      )}

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
                background:
                  myScore?.name === p.name
                    ? "var(--green-light)"
                    : "transparent",
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
            {data.eyePrize.submissions?.photoUrl && (
              <img
                src={data.eyePrize.submissions.photoUrl}
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
              {data.eyePrize.submissions?.anonymous_id}
            </div>
            <div style={{ fontSize: ".8rem", color: "var(--ink-muted)" }}>
              {data.eyePrize.submissions?.users &&
                `par ${data.eyePrize.submissions.users.first_name} ${data.eyePrize.submissions.users.last_name}`}
              {data.eyePrize.submissions?.categories?.name &&
                ` · ${data.eyePrize.submissions.categories.name}`}
            </div>
          </div>
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
