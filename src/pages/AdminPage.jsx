// frontend/src/pages/AdminPage.jsx (version avec palmarès complet pour admin)
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
                onClick={() => {
                  setTab(t.id);
                  setShowMobileMenu(false);
                }}
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

      <nav className="bottom-nav">
        {TABS.slice(0, 5).map((t) => (
          <button
            key={t.id}
            className={`bottom-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span style={{ fontSize: ".55rem" }}>{t.label.slice(0, 8)}</span>
          </button>
        ))}
      </nav>

      {flash && <div className="flash">{flash}</div>}
    </>
  );
}

/* ════════════════════════════════════════════════════════
   ADMIN RESULTS TAB - Palmarès complet pour admin
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
      {/* SECTION GESTION */}
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
            Ordre : <strong>1.</strong> Calculer les résultats →{" "}
            <strong>2.</strong> Publier aux jurés → <strong>3.</strong> Publier
            aux participants
          </span>
        </div>

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
            className="btn btn-primary"
            onClick={handleCompute}
            disabled={computing}
            style={{ minWidth: "200px" }}
          >
            {computing ? "⏳ Calcul en cours..." : "🔄 Calculer les résultats"}
          </button>
        </div>

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
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1rem",
            flexWrap: "wrap",
          }}
        >
          <button
            className={`btn ${status.jurorsCanView ? "btn-success" : "btn-amber"}`}
            onClick={handlePublishToJurors}
            disabled={status.jurorsCanView || !hasResults}
            style={{ minWidth: "220px" }}
          >
            {status.jurorsCanView
              ? "✅ Jurés ont accès"
              : "👨‍⚖️ Publier aux jurés"}
          </button>

          <button
            className={`btn ${status.isPublished ? "btn-success" : "btn-green"}`}
            onClick={handlePublishToParticipants}
            disabled={status.isPublished || !hasResults}
            style={{ minWidth: "220px" }}
          >
            {status.isPublished
              ? "✅ Participants ont accès"
              : "🎉 Publier aux participants"}
          </button>

          <button
            className="btn btn-danger"
            onClick={handleUnpublishAll}
            disabled={!hasResults}
            style={{ minWidth: "150px" }}
          >
            🔒 Tout masquer
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            padding: "1rem",
            background: "var(--sand)",
            borderRadius: "12px",
          }}
        >
          <div className={`badge ${hasResults ? "badge-green" : "badge-ink"}`}>
            📊 Résultats: {hasResults ? "Calculés ✅" : "Non calculés ⏳"}
          </div>
          <div
            className={`badge ${status.jurorsCanView ? "badge-green" : "badge-ink"}`}
          >
            👨‍⚖️ Jurés: {status.jurorsCanView ? "Accès ✅" : "Non publié ⏳"}
          </div>
          <div
            className={`badge ${status.isPublished ? "badge-green" : "badge-ink"}`}
          >
            🎉 Participants: {status.isPublished ? "Accès ✅" : "Non publié ⏳"}
          </div>
        </div>
      </div>

      {/* AFFICHAGE DU PALMARÈS COMPLET POUR ADMIN */}
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

/* ── Composant d'affichage du palmarès pour admin (même visuel que juré) ── */
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Photo d'Or - Meilleur Photographe */}
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

      {/* 2. Classement général complet */}
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
        ) : isAdmin && eyePrizeMode ? (
          <div className="panel">
            <div className="section-header">
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
              style={{ maxHeight: "400px", overflowY: "auto" }}
            >
              {(data.allSubmissions || []).map((sub) => (
                <div
                  key={sub.id}
                  className="photo-item"
                  onClick={() => onSelectEyePrize(sub.id)}
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
            onClick={() => setEyePrizeMode(true)}
          >
            👁️ Attribuer le Prix de l'œil
          </button>
        )}
      </div>
    </div>
  );
}
