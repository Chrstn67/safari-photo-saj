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
  const fileRef = useRef();

  useEffect(() => {
    load();
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

  const TABS = [
    { id: "bank", label: "Ma banque", icon: "🖼️" },
    { id: "submit", label: "Soumettre", icon: "📤" },
    { id: "results", label: "Résultats", icon: "🏆" },
  ];

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
              className="btn btn-sm"
              onClick={logout}
              style={{
                borderColor: "rgba(255,255,255,.25)",
                color: "var(--sand)",
                background: "transparent",
              }}
            >
              Déco
            </button>
          </>
        }
      />

      {/* Bottom Nav — structure identique à Admin/Jury mais sans burger
          (pas de side-panel sur cette page) */}
      <nav className="bottom-nav">
        <div className="bottom-tabs">
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
        </div>
      </nav>

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
                  <span className="spinner" style={{ width: 14, height: 14 }} />
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
                    {photo.url ? (
                      <img src={photo.url} alt="" loading="lazy" />
                    ) : (
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
              Une seule photo par catégorie. Une fois soumise, elle ne peut plus
              être modifiée.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: ".75rem",
              }}
            >
              {categories.map((cat) => {
                const myPhotos = photos.filter((p) => !p.is_submitted);
                return (
                  <div
                    key={cat.id}
                    className="panel"
                    style={{ padding: "1rem" }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: ".35rem" }}>
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
                    {myPhotos.length === 0 ? (
                      <p
                        style={{
                          fontSize: ".78rem",
                          color: "var(--ink-faint)",
                        }}
                      >
                        Aucune photo disponible — ajoutez-en dans votre banque.
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
        {tab === "results" && <ResultsPanel />}
      </div>

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
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    className="btn btn-full"
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => handleSubmit(submitModal, cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PREVIEW ── */}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div
            style={{ maxWidth: 700, width: "100%", padding: "0 1rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {preview.url && (
              <img
                src={preview.url}
                alt=""
                style={{
                  width: "100%",
                  borderRadius: 12,
                  maxHeight: "75dvh",
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
                flexWrap: "wrap",
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

function ResultsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/results/palmares")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return (
      <div className="empty-state">
        <div className="empty-icon">🔒</div>
        <div className="empty-title">Résultats non disponibles</div>
        <p>Les résultats seront publiés après la cérémonie.</p>
      </div>
    );
  if (!data)
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <span className="spinner spinner-lg" />
      </div>
    );

  return (
    <div className="section">
      <div className="section-header">
        <div className="section-title">🏆 Palmarès</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
        {(data.byCategory || [])
          .filter((r) => r.rank === 1)
          .map((r, i) => (
            <div key={i} className="card">
              <div
                style={{
                  fontSize: ".72rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  marginBottom: ".25rem",
                }}
              >
                {r.categories?.name}
              </div>
              <div
                style={{
                  fontFamily: "DM Serif Display,serif",
                  fontSize: "1.1rem",
                  color: "var(--amber)",
                }}
              >
                🥇{" "}
                {r.submissions?.users
                  ? `${r.submissions.users.first_name} ${r.submissions.users.last_name}`
                  : r.submissions?.anonymous_id}
              </div>
              <div
                style={{
                  fontSize: ".8rem",
                  color: "var(--ink-muted)",
                  marginTop: ".25rem",
                }}
              >
                Moyenne : {r.average_score}/20
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
