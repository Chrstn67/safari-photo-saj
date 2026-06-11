// frontend/src/pages/AdminPage.jsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../server/hooks/useAuth.jsx";
import { api } from "../../server/utils/api.js";
import { subscribe } from "../../server/utils/realtime.js";
import TopBar from "../components/TopBar.jsx";
import AdminUsersTab from "./AdminUsersTab.jsx";

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [flash, setFlash] = useState("");
  const [finalizingEyePrize, setFinalizingEyePrize] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2800);
  }

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "deliberation", label: "Délibérations", icon: "🔴" },
    { id: "users", label: "Utilisateurs", icon: "👥" },
    { id: "categories", label: "Catégories", icon: "🗂️" },
    { id: "criteria", label: "Critères", icon: "📐" },
    { id: "results", label: "Résultats", icon: "🏆" },
    { id: "audit", label: "Audit", icon: "📋" },
  ];

  // Ferme le menu si on clique sur un onglet
  function handleTabChange(id) {
    setTab(id);
    setShowMobileMenu(false);
  }

  return (
    <>
      <TopBar
        title={
          <>
            📸 Safari · <span>Admin</span>
          </>
        }
        right={
          <>
            <span className="topbar-user">{user?.firstName} (admin)</span>
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
                onClick={() => handleTabChange(t.id)}
              >
                <span className="tab-icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="main-content">
          <div className="page">
            {tab === "dashboard" && <DashboardTab showFlash={showFlash} />}
            {tab === "deliberation" && (
              <DeliberationTab showFlash={showFlash} />
            )}
            {tab === "users" && <AdminUsersTab showFlash={showFlash} />}
            {tab === "categories" && <CategoriesTab showFlash={showFlash} />}
            {tab === "criteria" && <CriteriaTab showFlash={showFlash} />}
            {tab === "results" && (
              <AdminResultsTab showFlash={showFlash} user={user} />
            )}
            {tab === "audit" && <AuditTab />}
          </div>
        </div>
      </div>

      {/* Bottom nav mobile : burger à gauche + onglets */}
      <nav className="bottom-nav">
        <button
          className={`bottom-burger${showMobileMenu ? " active" : ""}`}
          onClick={() => setShowMobileMenu(!showMobileMenu)}
          aria-label="Menu"
        >
          <span style={{ fontSize: "1.2rem" }}>
            {showMobileMenu ? "✕" : "☰"}
          </span>
          <span className="burger-label">Menu</span>
        </button>
        <div className="bottom-tabs">
          {TABS.slice(0, 5).map((t) => (
            <button
              key={t.id}
              className={`bottom-tab${tab === t.id ? " active" : ""}`}
              onClick={() => handleTabChange(t.id)}
            >
              <span className="tab-icon">{t.icon}</span>
              <span>{t.label.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      </nav>

      {flash && <div className="flash">{flash}</div>}
    </>
  );
}

/* ════════════════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════════════════ */
function DashboardTab({ showFlash }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api
      .get("/admin/dashboard")
      .then(setData)
      .catch((e) => showFlash("❌ " + e.message));
  }, []);

  if (!data) return <Loader />;

  const stats = [
    { icon: "👥", label: "Participants", value: data.participants },
    { icon: "🎤", label: "Jurés", value: data.jurors },
    { icon: "🖼️", label: "Photos", value: data.totalPhotos },
    { icon: "📤", label: "Soumissions", value: data.totalSubmissions },
  ];

  return (
    <div>
      <div className="section">
        <div className="section-header">
          <div className="section-title">Vue d'ensemble</div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: ".75rem",
          }}
        >
          {stats.map((s) => (
            <div key={s.label} className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", marginBottom: ".3rem" }}>
                {s.icon}
              </div>
              <div
                style={{
                  fontFamily: "DM Serif Display, serif",
                  fontSize: "1.5rem",
                  color: "var(--amber)",
                }}
              >
                {s.value ?? "—"}
              </div>
              <div
                style={{
                  fontSize: ".75rem",
                  color: "var(--ink-muted)",
                  marginTop: ".15rem",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <div className="section-title">Sessions de délibération</div>
        </div>
        <div className="panel">
          {(data.sessions || []).map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: ".65rem 1rem",
                borderBottom: "1px solid var(--sand-border)",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: ".88rem" }}>
                {s.categories?.name || `Cat. ${s.category_id}`}
              </span>
              <span
                className={`badge ${s.status === "open" ? "badge-green" : s.status === "completed" ? "badge-amber" : "badge-ink"}`}
              >
                {s.status === "open"
                  ? "🟢 En cours"
                  : s.status === "completed"
                    ? "✅ Terminé"
                    : "⏸️ " + s.status}
              </span>
            </div>
          ))}
          {!data.sessions?.length && (
            <div
              style={{
                padding: "1rem",
                color: "var(--ink-faint)",
                fontSize: ".84rem",
              }}
            >
              Aucune session créée
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <div className="section-title">Publication</div>
        </div>
        <div className="info-banner banner-amber">
          <span className="banner-icon">
            {data.resultsPublished ? "🟢" : "🔴"}
          </span>
          {data.resultsPublished
            ? "Les résultats sont actuellement publiés."
            : "Les résultats ne sont pas encore publiés."}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   DÉLIBÉRATIONS - AVEC SUPPRESSION DE SESSION
════════════════════════════════════════════════════════ */
function DeliberationTab({ showFlash }) {
  const [categories, setCategories] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [validations, setValidations] = useState({});
  const [loading, setLoading] = useState(false);
  const [forceNextLoading, setForceNextLoading] = useState(false);
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, sess] = await Promise.all([
        api.get("/categories"),
        api.get("/deliberations"),
      ]);
      setCategories(cats);
      setSessions(sess);
    } catch (e) {
      showFlash("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribe("deliberation_sessions", "*", load);
    return unsub;
  }, [load]);

  useEffect(() => {
    sessions
      .filter((s) => s.status === "open")
      .forEach(async (s) => {
        const v = await api
          .get(`/deliberations/${s.category_id}/validations`)
          .catch(() => null);
        if (v)
          setValidations((prev) => ({
            ...prev,
            [s.category_id]: v.validations,
          }));
      });
  }, [sessions]);

  async function openCategory(categoryId) {
    try {
      await api.post("/deliberations/open", { categoryId });
      showFlash("🟢 Délibération ouverte");
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function forceNext(categoryId) {
    if (!confirm("Forcer le passage à la photo suivante ?")) return;
    try {
      const res = await api.post("/deliberations/next", {
        categoryId,
        forced: true,
      });
      showFlash(res.done ? "✅ Catégorie terminée" : "⏩ Photo suivante");
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function closeCategory(categoryId) {
    if (!confirm("Fermer définitivement cette délibération ?")) return;
    try {
      await api.post("/deliberations/close", { categoryId });
      showFlash("🔴 Délibération fermée");
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function resetCategory(categoryId) {
    if (!confirm("⚠️ Réinitialiser toutes les notes de cette catégorie ?"))
      return;
    try {
      await api.post("/deliberations/reset", { categoryId });
      showFlash("🔄 Catégorie réinitialisée");
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function forceNextGlobal() {
    // Trouver la session ouverte
    const openSession = sessions.find((s) => s.status === "open");
    if (!openSession) {
      showFlash("⚠️ Aucune délibération en cours");
      return;
    }

    if (
      !confirm(
        `Forcer le passage à la photo suivante dans "${openSession.categories?.name}" ?`,
      )
    )
      return;

    setForceNextLoading(true);
    try {
      const res = await api.post("/deliberations/next", {
        categoryId: openSession.category_id,
        forced: true,
      });
      if (res.done) {
        showFlash("✅ Catégorie terminée !");
      } else {
        showFlash("⏩ Photo suivante");
      }
      load(); // Recharger les sessions
    } catch (e) {
      showFlash("❌ " + e.message);
    } finally {
      setForceNextLoading(false);
    }
  }

  // Ajouter ce bouton en haut du composant DeliberationTab, avant la liste des catégories
  {
    /* Bouton "Photo suivante" unique */
  }
  <div style={{ marginBottom: "1rem" }}>
    <button
      className={`btn btn-primary ${forceNextLoading ? "loading" : ""}`}
      onClick={forceNextGlobal}
      disabled={forceNextLoading || !sessions.some((s) => s.status === "open")}
      style={{
        background: "var(--amber)",
        padding: ".6rem 1.2rem",
        fontSize: ".9rem",
      }}
    >
      {forceNextLoading ? "⏳" : "⏩ Photo suivante"}
    </button>
    <span
      style={{
        fontSize: ".75rem",
        marginLeft: ".75rem",
        color: "var(--ink-muted)",
      }}
    >
      {sessions.some((s) => s.status === "open")
        ? "Forcer le passage à la photo suivante (même si tous les jurés n'ont pas validé)"
        : "Aucune session ouverte"}
    </span>
  </div>;

  /* ── Supprimer complètement une session ── */
  async function deleteSession(categoryId, categoryName) {
    const msg =
      `⚠️ SUPPRESSION COMPLÈTE DE LA SESSION ⚠️\n\n` +
      `Catégorie : ${categoryName}\n\n` +
      `⚠️ Cette action va :\n` +
      `• Supprimer TOUTES les soumissions dans cette catégorie\n` +
      `• Remettre à zéro les photos (elles redeviennent disponibles)\n` +
      `• Supprimer toutes les notes et validations\n` +
      `• Supprimer les coups de cœur\n` +
      `• Supprimer les résultats calculés\n\n` +
      `✅ Ce qui est CONSERVÉ :\n` +
      `• Les utilisateurs (participants, jurés, admin)\n` +
      `• Les photos dans la banque des participants\n\n` +
      `Action irréversible. Confirmer la suppression ?`;

    if (!confirm(msg)) return;

    try {
      await api.delete(`/deliberations/session/${categoryId}`);
      showFlash(`🗑️ Session "${categoryName}" supprimée avec succès`);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  return (
    <div>
      <div className="section">
        <div className="section-header">
          <div className="section-title">Gestion des délibérations</div>
        </div>
        <div
          className="info-banner banner-amber"
          style={{ marginBottom: "1rem" }}
        >
          <span className="banner-icon">🎯</span>
          Ouvrez les catégories une par une. Le passage à la photo suivante est
          automatique quand tous les jurés ont validé.
        </div>
        <div
          className="info-banner banner-blue"
          style={{ marginBottom: "1rem" }}
        >
          <span className="banner-icon">🗑️</span>
          <strong>Nouveau :</strong> Vous pouvez maintenant supprimer
          complètement une session. Les participants conservent leurs photos
          dans leur banque, mais les soumissions et notes sont effacées.
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <span className="spinner" />
          </div>
        )}

        <div
          style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}
        >
          {categories.map((cat) => {
            const session = sessions.find((s) => s.category_id === cat.id);
            const vals = validations[cat.id] || [];
            const isOpen = session?.status === "open";
            const hasSession = session !== undefined;

            return (
              <div key={cat.id} className="panel">
                <div
                  style={{
                    padding: ".85rem 1rem",
                    borderBottom: "1px solid var(--sand-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: ".5rem",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: ".92rem" }}>
                      {cat.name}
                    </div>
                    <div
                      style={{ fontSize: ".76rem", color: "var(--ink-muted)" }}
                    >
                      {cat.description}
                    </div>
                  </div>
                  <span
                    className={`badge ${isOpen ? "badge-green" : session?.status === "completed" ? "badge-amber" : hasSession ? "badge-ink" : "badge-red"}`}
                  >
                    {isOpen
                      ? "🟢 En cours"
                      : session?.status === "completed"
                        ? "✅ Terminé"
                        : session?.status === "closed"
                          ? "🔴 Fermé"
                          : hasSession
                            ? "⏸️ En attente"
                            : "⚪ Aucune session"}
                  </span>
                </div>

                {isOpen && session?.current_photo && (
                  <div
                    style={{
                      padding: ".65rem 1rem",
                      background: "var(--sand)",
                      borderBottom: "1px solid var(--sand-border)",
                      fontSize: ".82rem",
                    }}
                  >
                    📸 Photo en cours :{" "}
                    <strong>{session.current_photo.anonymous_id}</strong>
                    {session.current_photo.display_order && (
                      <span
                        style={{
                          color: "var(--ink-muted)",
                          marginLeft: ".5rem",
                        }}
                      >
                        #{session.current_photo.display_order}
                      </span>
                    )}
                  </div>
                )}

                {isOpen && vals.length > 0 && (
                  <div
                    className="validation-grid"
                    style={{ borderBottom: "1px solid var(--sand-border)" }}
                  >
                    {vals.map((v) => (
                      <div key={v.jurorId} className="validation-chip">
                        <span
                          className={`v-dot ${v.validated ? "validated" : "pending"}`}
                        />
                        {v.name} {v.validated ? "✅" : "⏳"}
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    padding: ".75rem 1rem",
                    display: "flex",
                    gap: ".5rem",
                    flexWrap: "wrap",
                  }}
                >
                  {!hasSession ? (
                    <button
                      className="btn btn-green btn-sm"
                      onClick={() => openCategory(cat.id)}
                    >
                      🟢 Créer & ouvrir
                    </button>
                  ) : isOpen ? (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => forceNext(cat.id)}
                      >
                        ⏩ Forcer suivante
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => closeCategory(cat.id)}
                      >
                        🔴 Fermer
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-green btn-sm"
                      onClick={() => openCategory(cat.id)}
                      disabled={session?.status === "completed"}
                      title={
                        session?.status === "completed"
                          ? "Catégorie déjà terminée"
                          : ""
                      }
                    >
                      🟢 Ouvrir
                    </button>
                  )}

                  {hasSession && (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => resetCategory(cat.id)}
                      >
                        🔄 Réinitialiser notes
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        style={{
                          background: "var(--red-light)",
                          color: "var(--red)",
                        }}
                        onClick={() => deleteSession(cat.id, cat.name)}
                      >
                        🗑️ Supprimer session
                      </button>
                    </>
                  )}
                </div>

                {hasSession && (
                  <div
                    style={{
                      padding: ".5rem 1rem",
                      background: "var(--sand-dark)",
                      fontSize: ".7rem",
                      color: "var(--ink-muted)",
                      borderTop: "1px solid var(--sand-border)",
                    }}
                  >
                    <span>
                      ℹ️ La suppression d'une session efface toutes les
                      soumissions et notes,{" "}
                    </span>
                    <strong>
                      mais les photos restent dans la banque des participants
                    </strong>
                    <span> pour une nouvelle soumission.</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <div className="section-title">Ma notation (en tant que juré)</div>
        </div>
        <AdminJuryNotation showFlash={showFlash} sessions={sessions} />
      </div>
    </div>
  );
}

function AdminJuryNotation({ showFlash, sessions }) {
  const { user } = useAuth();
  const [criteria, setCriteria] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [scores, setScores] = useState({});
  const [validated, setValidated] = useState(false);

  useEffect(() => {
    api
      .get("/criteria")
      .then(setCriteria)
      .catch(() => {});
    const open = sessions.find((s) => s.status === "open");
    if (open) {
      setActiveSession(open);
      if (open.current_photo?.url) {
        setCurrentPhoto(open.current_photo);
      }
    }
  }, [sessions]);

  useEffect(() => {
    if (!activeSession?.current_photo?.id && activeSession?.current_photo_id) {
      loadPhoto(activeSession.category_id, activeSession.current_photo_id);
    } else if (activeSession?.current_photo?.id) {
      loadScores(activeSession.current_photo.id);
    }
  }, [activeSession]);

  async function loadPhoto(categoryId, photoId) {
    try {
      const photoData = await api.get(
        `/categories/${categoryId}/current-photo`,
      );
      if (photoData.photo) {
        setCurrentPhoto(photoData.photo);
        await loadScores(photoId);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function loadScores(photoId) {
    try {
      const myScores = await api.get(`/scores/${photoId}`);
      const map = {};
      (myScores || []).forEach((s) => {
        map[s.criterion_id] = s.value;
      });
      setScores(map);

      const vals = await api.get(
        `/deliberations/${activeSession.category_id}/validations`,
      );
      const myVal = vals.validations?.find((v) => v.jurorId === user.id);
      setValidated(!!myVal?.validated);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleScore(criterionId, value) {
    if (validated) return;
    const v = Math.max(
      0,
      Math.min(
        criteria.find((c) => c.id === criterionId)?.max_points || 5,
        parseFloat(value) || 0,
      ),
    );
    setScores((p) => ({ ...p, [criterionId]: v }));
    await api
      .put("/scores", { submissionId: currentPhoto.id, criterionId, value: v })
      .catch(() => {});
  }

  async function handleValidate() {
    try {
      await api.post("/scores/validate", { submissionId: currentPhoto.id });
      setValidated(true);
      showFlash("✅ Notes validées");
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

  if (!activeSession)
    return (
      <div className="info-banner banner-amber">
        <span className="banner-icon">⏸️</span>
        Aucune catégorie ouverte. Utilisez le panneau ci-dessus pour démarrer
        une délibération.
      </div>
    );

  const total = Object.values(scores).reduce(
    (a, b) => a + (parseFloat(b) || 0),
    0,
  );
  const maxTotal = criteria.reduce((a, c) => a + (c.max_points || 5), 0);

  return (
    <div className="panel">
      {currentPhoto?.url && (
        <img
          src={currentPhoto.url}
          alt=""
          style={{
            width: "100%",
            maxHeight: 300,
            objectFit: "contain",
            background: "#111",
            borderRadius: 8,
          }}
        />
      )}
      <div
        style={{
          padding: ".5rem .85rem",
          background: "var(--sand)",
          borderBottom: "1px solid var(--sand-border)",
          fontSize: ".78rem",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          🔒{" "}
          {currentPhoto?.anonymous_id ||
            activeSession.current_photo?.anonymous_id ||
            "—"}{" "}
          — mode anonyme
        </span>
        <button
          className="btn btn-sm"
          onClick={handleFavorite}
          title="Coup de cœur"
        >
          ❤️
        </button>
      </div>
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
              onChange={(e) => handleScore(c.id, e.target.value)}
              disabled={validated}
            />
            <span className="score-max">/ {c.max_points}</span>
          </div>
        </div>
      ))}
      <div
        style={{
          padding: ".75rem 1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="score-total">
          {total.toFixed(1)} / {maxTotal} pts
        </span>
        <button
          className={`btn${validated ? "" : " btn-primary"}`}
          onClick={handleValidate}
          disabled={validated}
        >
          {validated ? "✅ Validé" : "Valider"}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   CATEGORIES
════════════════════════════════════════════════════════ */
function CategoriesTab({ showFlash }) {
  const [cats, setCats] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", sortOrder: 0 });

  const load = () =>
    api
      .get("/admin/categories")
      .then(setCats)
      .catch((e) => showFlash("❌ " + e.message));
  useEffect(() => {
    load();
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    try {
      if (modal === "create") await api.post("/admin/categories", form);
      else await api.put(`/admin/categories/${modal.id}`, form);
      showFlash("✅ Catégorie enregistrée");
      setModal(null);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function toggleActive(cat) {
    await api
      .put(`/admin/categories/${cat.id}`, { isActive: !cat.is_active })
      .then(() => {
        showFlash("✅ Mis à jour");
        load();
      })
      .catch((e) => showFlash("❌ " + e.message));
  }

  async function handleDelete(cat) {
    if (!confirm(`Supprimer "${cat.name}" ?`)) return;
    await api
      .delete(`/admin/categories/${cat.id}`)
      .then(() => {
        showFlash("🗑️ Supprimée");
        load();
      })
      .catch((e) => showFlash("❌ " + e.message));
  }

  /* ── Réinitialiser une catégorie ── */
  async function handleResetCategory(cat) {
    const msg =
      `⚠️ RÉINITIALISATION DE LA CATÉGORIE ⚠️\n\n` +
      `Catégorie : ${cat.name}\n\n` +
      `Cette action va :\n` +
      `• Supprimer TOUTES les soumissions dans cette catégorie\n` +
      `• Remettre à zéro les photos (elles redeviennent disponibles)\n` +
      `• Supprimer toutes les notes et validations\n` +
      `• Supprimer les coups de cœur\n` +
      `• Supprimer les résultats calculés\n\n` +
      `Les photos restent dans la banque des participants.\n\n` +
      `Confirmer la réinitialisation ?`;

    if (!confirm(msg)) return;

    try {
      await api.post(`/admin/categories/${cat.id}/reset`);
      showFlash(`🔄 Catégorie "${cat.name}" réinitialisée`);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  return (
    <div className="section">
      <div className="section-header">
        <div className="section-title">Catégories</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setForm({ name: "", description: "", sortOrder: 0 });
            setModal("create");
          }}
        >
          + Créer
        </button>
      </div>
      <div className="panel">
        {cats.map((cat) => (
          <div
            key={cat.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: ".75rem",
              padding: ".7rem 1rem",
              borderBottom: "1px solid var(--sand-border)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: ".88rem" }}>
                {cat.name}
              </div>
              {cat.description && (
                <div style={{ fontSize: ".76rem", color: "var(--ink-muted)" }}>
                  {cat.description}
                </div>
              )}
            </div>
            <span
              className={`badge ${cat.is_active ? "badge-green" : "badge-red"}`}
              style={{ flexShrink: 0 }}
            >
              {cat.is_active ? "Active" : "Inactive"}
            </span>
            <div
              style={{
                display: "flex",
                gap: ".3rem",
                flexShrink: 0,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn btn-sm"
                onClick={() => {
                  setForm({
                    name: cat.name,
                    description: cat.description || "",
                    sortOrder: cat.sort_order,
                  });
                  setModal(cat);
                }}
              >
                ✏️
              </button>
              <button className="btn btn-sm" onClick={() => toggleActive(cat)}>
                {cat.is_active ? "🔴" : "🟢"}
              </button>
              <button
                className="btn btn-sm btn-warning"
                onClick={() => handleResetCategory(cat)}
                title="Réinitialiser toutes les soumissions"
                style={{
                  background: "var(--amber-light)",
                  color: "var(--amber)",
                  borderColor: "var(--amber-mid)",
                }}
              >
                🔄
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => handleDelete(cat)}
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {modal === "create"
                  ? "Nouvelle catégorie"
                  : `Modifier : ${modal.name}`}
              </h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: ".75rem",
              }}
            >
              <div className="field-group">
                <label>Nom</label>
                <input
                  className="field"
                  value={form.name}
                  onChange={set("name")}
                />
              </div>
              <div className="field-group">
                <label>Description</label>
                <input
                  className="field"
                  value={form.description}
                  onChange={set("description")}
                />
              </div>
              <div className="field-group">
                <label>Ordre</label>
                <input
                  className="field"
                  type="number"
                  value={form.sortOrder}
                  onChange={set("sortOrder")}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   CRITÈRES
════════════════════════════════════════════════════════ */
function CriteriaTab({ showFlash }) {
  const [criteria, setCriteria] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    icon: "📷",
    maxPoints: 5,
    weight: 1,
  });

  const load = () =>
    api
      .get("/admin/criteria")
      .then(setCriteria)
      .catch((e) => showFlash("❌ " + e.message));
  useEffect(() => {
    load();
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    try {
      if (modal === "create") await api.post("/admin/criteria", form);
      else await api.put(`/admin/criteria/${modal.id}`, form);
      showFlash("✅ Critère enregistré");
      setModal(null);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  return (
    <div className="section">
      <div className="section-header">
        <div className="section-title">Critères de notation</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setForm({
              name: "",
              description: "",
              icon: "📷",
              maxPoints: 5,
              weight: 1,
            });
            setModal("create");
          }}
        >
          + Ajouter
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: ".75rem",
        }}
      >
        {criteria.map((c) => (
          <div key={c.id} className="card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: ".5rem",
              }}
            >
              <div style={{ fontSize: "1.3rem" }}>{c.icon}</div>
              <div style={{ display: "flex", gap: ".3rem" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setForm({
                      name: c.name,
                      description: c.description || "",
                      icon: c.icon || "📷",
                      maxPoints: c.max_points,
                      weight: c.weight,
                    });
                    setModal(c);
                  }}
                >
                  ✏️
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() =>
                    api
                      .delete(`/admin/criteria/${c.id}`)
                      .then(() => {
                        showFlash("🗑️");
                        load();
                      })
                      .catch((e) => showFlash("❌ " + e.message))
                  }
                >
                  🗑️
                </button>
              </div>
            </div>
            <div style={{ fontWeight: 700, marginBottom: ".25rem" }}>
              {c.name}
            </div>
            <div
              style={{
                fontSize: ".76rem",
                color: "var(--ink-muted)",
                marginBottom: ".5rem",
              }}
            >
              {c.description}
            </div>
            <span className="badge badge-amber">/ {c.max_points} pts</span>
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {modal === "create"
                  ? "Nouveau critère"
                  : `Modifier : ${modal.name}`}
              </h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: ".75rem",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 3fr",
                  gap: ".5rem",
                }}
              >
                <div className="field-group">
                  <label>Icône</label>
                  <input
                    className="field"
                    value={form.icon}
                    onChange={set("icon")}
                  />
                </div>
                <div className="field-group">
                  <label>Nom</label>
                  <input
                    className="field"
                    value={form.name}
                    onChange={set("name")}
                  />
                </div>
              </div>
              <div className="field-group">
                <label>Description</label>
                <input
                  className="field"
                  value={form.description}
                  onChange={set("description")}
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: ".5rem",
                }}
              >
                <div className="field-group">
                  <label>Points max</label>
                  <input
                    className="field"
                    type="number"
                    value={form.maxPoints}
                    onChange={set("maxPoints")}
                    min="1"
                    max="20"
                  />
                </div>
                <div className="field-group">
                  <label>Poids</label>
                  <input
                    className="field"
                    type="number"
                    value={form.weight}
                    onChange={set("weight")}
                    min="0.1"
                    max="5"
                    step=".1"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ADMIN RESULTS TAB
════════════════════════════════════════════════════════ */
function AdminResultsTab({ showFlash, user }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({
    isPublished: false,
    jurorsCanView: false,
    hasResults: false,
  });
  const [computing, setComputing] = useState(false);
  const [selectingEyePrize, setSelectingEyePrize] = useState(false);
  const [palmaresData, setPalmaresData] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statusData, resultsData, palmaresData] = await Promise.all([
        api.get("/results/status"),
        api.get("/results").catch(() => null),
        api.get("/results/palmares").catch(() => null),
      ]);
      setStatus(statusData);
      setResults(resultsData);
      setPalmaresData(palmaresData);
    } catch (e) {
      console.error("Erreur chargement résultats:", e);
      showFlash("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeEyePrize = async () => {
    setFinalizingEyePrize(true);
    try {
      const result = await api.post("/results/eye-prize/finalize");
      if (result.hasTie) {
        showFlash(
          "⚠️ Égalité détectée ! Utilisez 'Résoudre l'égalité' pour choisir le gagnant.",
        );
      } else {
        showFlash(
          `✅ Prix de l'œil finalisé ! La photo gagnante a reçu ${result.totalVotes} vote(s).`,
        );
      }
      await loadData();
    } catch (e) {
      if (e.message.includes("Égalité")) {
        showFlash(
          "⚠️ Égalité détectée ! Cliquez sur 'Résoudre l'égalité' pour départager.",
        );
      } else {
        showFlash("❌ " + e.message);
      }
    } finally {
      setFinalizingEyePrize(false);
    }
  };

  const handleResolveEyePrizeTie = async (winningSubmissionId) => {
    if (!confirm("Confirmer cette photo comme gagnante du Prix de l'œil ?"))
      return;
    try {
      await api.post("/results/eye-prize/resolve-tie", { winningSubmissionId });
      showFlash("✅ Égalité résolue - Prix de l'œil finalisé !");
      await loadData();
      setSelectingEyePrize(false);
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  };

  const handleCompute = async () => {
    setComputing(true);
    try {
      const res = await api.post("/results/compute");
      showFlash(`✅ ${res.computed} résultats calculés !`);
      await loadData();
    } catch (e) {
      showFlash("❌ " + (e.message || "Vérifiez qu'il y a des notes saisies"));
    } finally {
      setComputing(false);
    }
  };

  const handlePublishToJurors = async () => {
    try {
      await api.post("/results/publish-to-jurors");
      showFlash("👨‍⚖️ Résultats visibles par les jurés !");
      await loadData();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  };

  const handlePublishToParticipants = async () => {
    try {
      await api.post("/results/publish-to-participants");
      showFlash("🎉 Résultats publiés aux participants !");
      await loadData();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  };

  const handleUnpublishAll = async () => {
    if (
      !confirm(
        "⚠️ Masquer tous les résultats ? Jurés et participants n'y auront plus accès.",
      )
    )
      return;
    try {
      await api.post("/results/unpublish");
      showFlash("🔒 Tous les résultats sont masqués");
      await loadData();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  };

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

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  const hasResults = status.hasResults || (results && results.length > 0);
  const isAdmin = user?.role === "admin";

  return (
    <div>
      <div className="section">
        <div className="section-header">
          <div className="section-title">🏆 Gestion des résultats</div>
        </div>

        <div
          className="info-banner banner-amber"
          style={{ marginBottom: "1.25rem" }}
        >
          <span className="banner-icon">📋</span>
          <span>
            Ordre : <strong>1.</strong> Calculer → <strong>2.</strong> Jurés →{" "}
            <strong>3.</strong> Participants
          </span>
        </div>

        {/* Étape 1 */}
        <div style={{ marginBottom: "1.25rem" }}>
          <div
            style={{
              fontSize: ".75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--ink-muted)",
              marginBottom: ".5rem",
            }}
          >
            Étape 1 — Calcul
          </div>
          <button
            className="btn btn-primary btn-full"
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? "⏳ Calcul en cours…" : "🔄 Calculer les résultats"}
          </button>
        </div>

        {/* Étapes 2 & 3 */}
        <div
          style={{
            fontSize: ".75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--ink-muted)",
            marginBottom: ".5rem",
          }}
        >
          Étapes 2 & 3 — Publication
        </div>
        <div
          className="btn-group-responsive"
          style={{
            marginBottom: "1rem",
            display: "flex",
            gap: ".5rem",
            flexWrap: "wrap",
          }}
        >
          <button
            className={`btn ${status.jurorsCanView ? "btn-success" : "btn-amber"}`}
            onClick={handlePublishToJurors}
            disabled={status.jurorsCanView || !hasResults}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {status.jurorsCanView
              ? "✅ Jurés ont accès"
              : "👨‍⚖️ Publier aux jurés"}
          </button>

          <button
            className={`btn ${status.isPublished ? "btn-success" : "btn-green"}`}
            onClick={handlePublishToParticipants}
            disabled={status.isPublished || !hasResults}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {status.isPublished
              ? "✅ Participants ont accès"
              : "🎉 Publier aux participants"}
          </button>

          <button
            className="btn btn-danger"
            onClick={handleUnpublishAll}
            disabled={!hasResults}
            style={{ flex: 1, justifyContent: "center" }}
          >
            🔒 Tout masquer
          </button>
        </div>

        {/* Statuts */}
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            flexWrap: "wrap",
            padding: "1rem",
            background: "var(--sand)",
            borderRadius: "12px",
          }}
        >
          <div className={`badge ${hasResults ? "badge-green" : "badge-ink"}`}>
            📊 {hasResults ? "Calculés ✅" : "Non calculés ⏳"}
          </div>
          <div
            className={`badge ${status.jurorsCanView ? "badge-green" : "badge-ink"}`}
          >
            👨‍⚖️ {status.jurorsCanView ? "Jurés ✅" : "Jurés ⏳"}
          </div>
          <div
            className={`badge ${status.isPublished ? "badge-green" : "badge-ink"}`}
          >
            🎉 {status.isPublished ? "Participants ✅" : "Participants ⏳"}
          </div>
        </div>
      </div>

      {!hasResults ? (
        <div className="info-banner banner-amber">
          <span className="banner-icon">📊</span>
          Aucun résultat calculé. Cliquez sur "Calculer les résultats"
          ci-dessus.
        </div>
      ) : palmaresData ? (
        <AdminPalmaresDisplay
          data={palmaresData}
          showFlash={showFlash}
          isAdmin={isAdmin}
          selectingEyePrize={selectingEyePrize}
          setSelectingEyePrize={setSelectingEyePrize}
          onSelectEyePrize={handleSelectEyePrize}
        />
      ) : null}
    </div>
  );
}

/* ── Composant d'affichage du palmarès pour admin ── */
function AdminPalmaresDisplay({
  data,
  showFlash,
  isAdmin,
  selectingEyePrize,
  setSelectingEyePrize,
  onSelectEyePrize,
}) {
  const [eyePrizeMode, setEyePrizeMode] = useState(false);

  if (!data || !data.generalRanking?.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🏆</div>
        <div className="empty-title">En attente des résultats</div>
        <p>Les résultats seront affichés ici après calcul.</p>
      </div>
    );
  }

  {
    isAdmin && !data.eyePrize && (
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn btn-primary"
          onClick={() => setEyePrizeMode(true)}
          disabled={data.eyePrizeVotes?.length === 0}
        >
          👁️ Lancer le vote
        </button>
        {data.eyePrizeVotes?.length > 0 && (
          <>
            <button
              className="btn btn-success"
              onClick={() => {
                // Finaliser automatiquement
                handleFinalizeEyePrize();
              }}
              disabled={finalizingEyePrize}
            >
              🏆 Finaliser le vote
            </button>
            {data.eyePrizeHasTie && (
              <button
                className="btn btn-warning"
                onClick={() => setSelectingEyePrize(true)}
              >
                ⚠️ Résoudre l'égalité
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {data.bestPhotographer && (
        <div className="section">
          <div className="section-header">
            <div className="section-title">
              🏆 Photo d'Or — Meilleur Photographe du SAJ
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

      <div className="section">
        <div className="section-header">
          <div className="section-title">📊 Classement général</div>
        </div>
        <div className="panel">
          {data.generalRanking.map((p, i) => (
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
                style={{
                  fontSize: i < 3 ? "1.5rem" : "1rem",
                  width: "40px",
                  flexShrink: 0,
                }}
              >
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <span
                style={{
                  flex: 1,
                  fontWeight: 600,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </span>
              <span className="badge badge-amber" style={{ flexShrink: 0 }}>
                {p.total?.toFixed(1)} pts
              </span>
            </div>
          ))}
        </div>
      </div>

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

      {/* 4. Coup de cœur du jury - Version ADMIN avec détails */}
      <div className="section">
        <div className="section-header">
          <div className="section-title">❤️ Coup de cœur du jury</div>
        </div>
        {data.favoriteCounts && data.favoriteCounts.length > 0 ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {data.favoriteCounts.map((fav, idx) => (
              <div key={idx} className="card" style={{ padding: "1rem" }}>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {fav.photoUrl ? (
                    <img
                      src={fav.photoUrl}
                      alt=""
                      style={{
                        width: "120px",
                        height: "120px",
                        objectFit: "cover",
                        borderRadius: "8px",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "120px",
                        height: "120px",
                        background: "var(--sand-dark)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "8px",
                      }}
                    >
                      📷
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                      {fav.photographerName || fav.anonymousId}
                    </div>
                    <div
                      style={{ fontSize: ".8rem", color: "var(--ink-muted)" }}
                    >
                      {fav.categoryName}
                    </div>
                    <div
                      className="badge badge-amber"
                      style={{ marginTop: ".5rem", display: "inline-block" }}
                    >
                      {fav.count} coup(s) de cœur
                    </div>
                  </div>
                </div>
                {/* Détail des jurés qui ont voté */}
                {fav.jurors && fav.jurors.length > 0 && (
                  <div
                    style={{
                      marginTop: "1rem",
                      paddingTop: "1rem",
                      borderTop: "1px solid var(--sand-border)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: ".75rem",
                        fontWeight: 600,
                        color: "var(--ink-muted)",
                        marginBottom: ".5rem",
                      }}
                    >
                      Voté par :
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: ".5rem",
                      }}
                    >
                      {fav.jurors.map((juror, jIdx) => (
                        <span
                          key={jIdx}
                          className="badge badge-ink"
                          style={{ fontSize: ".7rem" }}
                        >
                          {juror.name} -{" "}
                          {new Date(juror.votedAt).toLocaleDateString("fr-FR")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
        ) : isAdmin && eyePrizeMode ? (
          <div className="panel">
            <div
              className="section-header"
              style={{ padding: ".85rem 1rem 0" }}
            >
              <div className="section-title">
                Sélectionner la photo gagnante
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setEyePrizeMode(false)}
              >
                ✕
              </button>
            </div>
            <div
              className="photo-grid"
              style={{
                maxHeight: "400px",
                overflowY: "auto",
                padding: ".75rem",
              }}
            >
              {(data.allSubmissions || []).map((sub) => (
                <div
                  key={sub.id}
                  className="photo-item"
                  onClick={() => onSelectEyePrize(sub.id)}
                  style={{ cursor: "pointer" }}
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
        ) : isAdmin ? (
          <button
            className="btn btn-primary btn-full"
            onClick={() => setEyePrizeMode(true)}
          >
            👁️ Attribuer le Prix de l'œil
          </button>
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

/* ════════════════════════════════════════════════════════
   AUDIT
════════════════════════════════════════════════════════ */
function AuditTab() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api
      .get("/admin/audit")
      .then(setLogs)
      .catch(() => {});
  }, []);

  const ACTION_COLORS = {
    REGISTER: "badge-green",
    LOGIN: "badge-green",
    PHOTO_UPLOAD: "badge-amber",
    PHOTO_SUBMIT: "badge-amber",
    DELIB_OPEN: "badge-green",
    DELIB_CLOSE: "badge-red",
    DELIB_FORCE_NEXT: "badge-red",
    RESULTS_PUBLISH: "badge-green",
    RESULTS_UNPUBLISH: "badge-red",
    ADMIN_DELETE_USER: "badge-red",
    ADMIN_DELETE_PHOTO: "badge-red",
    DELIB_SESSION_DELETED: "badge-red",
    CATEGORY_RESET: "badge-amber",
  };

  return (
    <div className="section">
      <div className="section-header">
        <div className="section-title">Journal d'audit</div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>Entité</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td
                    style={{
                      fontSize: ".75rem",
                      color: "var(--ink-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(log.created_at).toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td style={{ fontSize: ".82rem" }}>
                    {log.users
                      ? `${log.users.first_name} ${log.users.last_name}`
                      : "—"}
                  </td>
                  <td>
                    <span
                      className={`badge ${ACTION_COLORS[log.action] || "badge-ink"}`}
                      style={{ fontSize: ".68rem" }}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td style={{ fontSize: ".78rem", color: "var(--ink-muted)" }}>
                    {log.entity}
                    {log.entity_id ? ` · ${log.entity_id.slice(0, 8)}…` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
      <span className="spinner spinner-lg" />
    </div>
  );
}
