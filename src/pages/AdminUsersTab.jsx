// frontend/src/pages/AdminUsersTab.jsx
// ═══════════════════════════════════════════════════════════════
// GESTION DES UTILISATEURS — onglet admin
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { api } from "../../server/utils/api.js";

const ROLES = {
  1: { label: "Participant", color: "#1A1612", bg: "#EDE6D8" },
  2: { label: "Juré", color: "#C8611A", bg: "#F5E6D5" },
  3: { label: "Admin", color: "#B84040", bg: "#F7E0DC" },
};

export default function AdminUsersTab({ showFlash }) {
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    password: "",
    roleId: "1",
  });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const data = await api.get("/admin/users");
      setUsers(data);
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }, [showFlash]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /* ── Changer le rôle d'un utilisateur ── */
  async function changeRole(user, newRoleId) {
    const roleLabel = ROLES[newRoleId]?.label || newRoleId;
    const msg =
      newRoleId === 2
        ? `Accorder le rôle JURÉ à ${user.first_name} ${user.last_name} ?`
        : newRoleId === 1
          ? `Rétrograder ${user.first_name} ${user.last_name} en PARTICIPANT ?`
          : `Passer ${user.first_name} ${user.last_name} en ADMIN ?`;

    if (!confirm(msg)) return;
    try {
      // Utiliser le bon endpoint PATCH /role
      await api.patch(`/admin/users/${user.id}/role`, { roleId: newRoleId });
      showFlash(`✅ ${user.first_name} est maintenant ${roleLabel}`);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.password) {
      showFlash("⚠️ Tous les champs sont requis");
      return;
    }
    setLoading(true);
    try {
      if (modal === "create") {
        await api.post("/admin/users", form);
        showFlash(`✅ Compte créé — rôle : ${ROLES[form.roleId]?.label}`);
      } else {
        // Modification (sans toucher au rôle — utiliser les boutons dédiés)
        const payload = {
          firstName: form.firstName,
          lastName: form.lastName,
        };
        if (form.password && form.password.length >= 6) {
          payload.password = form.password;
        }
        await api.put(`/admin/users/${modal.id}`, payload);
        showFlash("✅ Informations mises à jour");
      }
      setModal(null);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(user) {
    try {
      await api.put(`/admin/users/${user.id}`, { isActive: !user.is_active });
      showFlash(
        user.is_active
          ? `🔴 ${user.first_name} désactivé`
          : `🟢 ${user.first_name} activé`,
      );
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  async function handleDelete(user) {
    const msg =
      `⚠️ SUPPRESSION DÉFINITIVE\n\n` +
      `Utilisateur : ${user.first_name} ${user.last_name}\n` +
      `Rôle : ${ROLES[user.role_id]?.label}\n\n` +
      `⚠️ Cette action supprimera :\n` +
      `• Toutes ses photos\n` +
      `• Toutes ses soumissions\n` +
      `• Toutes ses notes et validations\n` +
      `• Ses favoris\n\n` +
      `Action irréversible. Confirmer ?`;

    if (!confirm(msg)) return;

    try {
      await api.delete(`/admin/users/${user.id}`);
      showFlash(`🗑️ ${user.first_name} ${user.last_name} supprimé`);
      load();
    } catch (e) {
      showFlash("❌ " + e.message);
    }
  }

  const filtered =
    filter === "all"
      ? users
      : users.filter((u) => String(u.role_id) === filter);
  const counts = { all: users.length, 1: 0, 2: 0, 3: 0 };
  users.forEach((u) => {
    counts[u.role_id] = (counts[u.role_id] || 0) + 1;
  });

  return (
    <div style={{ paddingBottom: "2rem" }}>
      <div style={S.headerRow}>
        <div>
          <div style={S.sectionTitle}>Utilisateurs inscrits</div>
          <div style={S.sectionSub}>
            {counts[1]} participant(s) · {counts[2]} juré(s) · {counts[3]}{" "}
            admin(s)
          </div>
        </div>
        <button
          style={S.btnPrimary}
          onClick={() => {
            setForm({ firstName: "", lastName: "", password: "", roleId: "1" });
            setModal("create");
          }}
        >
          + Créer un compte
        </button>
      </div>

      <div style={S.filterRow}>
        {[
          ["all", "Tous"],
          ["1", "Participants"],
          ["2", "Jurés"],
          ["3", "Admins"],
        ].map(([k, lbl]) => (
          <button
            key={k}
            style={{ ...S.filterBtn, ...(filter === k ? S.filterActive : {}) }}
            onClick={() => setFilter(k)}
          >
            {lbl} <span style={S.filterCount}>{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <div style={S.panel}>
        {filtered.length === 0 && (
          <div style={S.empty}>Aucun utilisateur dans cette catégorie.</div>
        )}
        {filtered.map((u) => (
          <div
            key={u.id}
            style={{ ...S.userRow, opacity: u.is_active ? 1 : 0.55 }}
          >
            <div style={S.userInfo}>
              <div style={S.userName}>
                {u.first_name} {u.last_name}
              </div>
              <div style={S.userMeta}>
                inscrit le {new Date(u.created_at).toLocaleDateString("fr-FR")}
                {!u.is_active && (
                  <span style={{ color: "#B84040", marginLeft: ".5rem" }}>
                    · compte désactivé
                  </span>
                )}
              </div>
            </div>

            <span
              style={{
                ...S.roleBadge,
                background: ROLES[u.role_id]?.bg,
                color: ROLES[u.role_id]?.color,
              }}
            >
              {ROLES[u.role_id]?.label}
            </span>

            <div style={S.actionGroup}>
              {u.role_id === 1 && (
                <button
                  style={S.btnAccent}
                  title="Accorder le rôle Juré"
                  onClick={() => changeRole(u, 2)}
                >
                  🎤 Juré
                </button>
              )}
              {u.role_id === 2 && (
                <button
                  style={S.btnNeutral}
                  title="Rétrograder en Participant"
                  onClick={() => changeRole(u, 1)}
                >
                  ↩ Participant
                </button>
              )}
              {u.role_id === 2 && (
                <button
                  style={S.btnNeutral}
                  title="Promouvoir Admin"
                  onClick={() => changeRole(u, 3)}
                >
                  ⭐ Admin
                </button>
              )}

              <button
                style={S.btnIcon}
                title="Modifier"
                onClick={() => {
                  setForm({
                    firstName: u.first_name,
                    lastName: u.last_name,
                    password: "",
                    roleId: String(u.role_id),
                  });
                  setModal(u);
                }}
              >
                ✏️
              </button>

              <button
                style={S.btnIcon}
                title={u.is_active ? "Désactiver" : "Activer"}
                onClick={() => toggleActive(u)}
              >
                {u.is_active ? "🔴" : "🟢"}
              </button>

              <button
                style={{ ...S.btnIcon, color: "#B84040" }}
                title="Supprimer"
                onClick={() => handleDelete(u)}
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={S.anonymatBanner}>
        <span style={{ fontSize: "1rem" }}>🔒</span>
        <span>
          <strong>Anonymat garanti :</strong> vous voyez ici qui est inscrit et
          son rôle, mais <em>jamais</em> à qui appartient une photo pendant les
          délibérations.
        </span>
      </div>

      {modal && (
        <div style={S.backdrop} onClick={() => setModal(null)}>
          <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <strong>
                {modal === "create"
                  ? "Créer un compte"
                  : `Modifier — ${modal.first_name} ${modal.last_name}`}
              </strong>
              <button style={S.closeBtn} onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <div style={S.modalBody}>
              <div style={S.row2}>
                <div style={S.fieldGroup}>
                  <label style={S.label}>Prénom</label>
                  <input
                    style={S.field}
                    value={form.firstName}
                    onChange={set("firstName")}
                  />
                </div>
                <div style={S.fieldGroup}>
                  <label style={S.label}>Nom</label>
                  <input
                    style={S.field}
                    value={form.lastName}
                    onChange={set("lastName")}
                  />
                </div>
              </div>

              {modal === "create" && (
                <div style={S.fieldGroup}>
                  <label style={S.label}>Rôle initial</label>
                  <select
                    style={S.field}
                    value={form.roleId}
                    onChange={set("roleId")}
                  >
                    <option value="1">Participant</option>
                    <option value="2">Juré</option>
                    <option value="3">Admin</option>
                  </select>
                </div>
              )}

              <div style={S.fieldGroup}>
                <label style={S.label}>
                  Mot de passe{" "}
                  {modal !== "create" && "(laisser vide = inchangé)"}
                </label>
                <input
                  style={S.field}
                  type="password"
                  value={form.password}
                  onChange={set("password")}
                  minLength={modal === "create" ? 6 : 0}
                  placeholder={modal !== "create" ? "••••••" : ""}
                />
              </div>
            </div>
            <div style={S.modalFooter}>
              <button style={S.btnNeutral} onClick={() => setModal(null)}>
                Annuler
              </button>
              <button
                style={{ ...S.btnPrimary, opacity: loading ? 0.7 : 1 }}
                onClick={handleSave}
                disabled={loading}
              >
                {loading ? "…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  headerRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: ".85rem",
    gap: "1rem",
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: "1.05rem",
    color: "var(--ink, #1A1612)",
  },
  sectionSub: { fontSize: ".76rem", color: "#6B5E50", marginTop: ".15rem" },
  filterRow: {
    display: "flex",
    gap: ".4rem",
    marginBottom: ".85rem",
    flexWrap: "wrap",
  },
  filterBtn: {
    background: "#fff",
    border: "1px solid #D8CFC0",
    borderRadius: 7,
    padding: ".3rem .75rem",
    fontSize: ".78rem",
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    color: "#6B5E50",
  },
  filterActive: {
    background: "#1A1612",
    color: "#F5F0E8",
    borderColor: "#1A1612",
  },
  filterCount: {
    background: "rgba(255,255,255,.2)",
    borderRadius: 10,
    padding: "0 5px",
    fontSize: ".7rem",
  },
  panel: {
    background: "#fff",
    border: "1px solid #D8CFC0",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(26,22,18,.08)",
  },
  userRow: {
    display: "flex",
    alignItems: "center",
    gap: ".75rem",
    padding: ".75rem 1rem",
    borderBottom: "1px solid #EDE6D8",
    flexWrap: "wrap",
  },
  userInfo: { flex: 1, minWidth: 140 },
  userName: { fontWeight: 600, fontSize: ".9rem", color: "#1A1612" },
  userMeta: { fontSize: ".72rem", color: "#A89880", marginTop: ".1rem" },
  roleBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 20,
    padding: ".2rem .75rem",
    fontSize: ".73rem",
    fontWeight: 600,
    flexShrink: 0,
  },
  actionGroup: {
    display: "flex",
    gap: ".3rem",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  btnPrimary: {
    background: "#C8611A",
    border: "none",
    borderRadius: 8,
    padding: ".45rem .9rem",
    color: "#fff",
    fontSize: ".8rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnAccent: {
    background: "#F5E6D5",
    border: "1px solid #E8A26A",
    borderRadius: 7,
    padding: ".3rem .65rem",
    color: "#C8611A",
    fontSize: ".76rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnNeutral: {
    background: "#fff",
    border: "1px solid #D8CFC0",
    borderRadius: 7,
    padding: ".3rem .65rem",
    color: "#6B5E50",
    fontSize: ".76rem",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnIcon: {
    background: "none",
    border: "1px solid #D8CFC0",
    borderRadius: 7,
    padding: ".3rem .5rem",
    fontSize: ".8rem",
    cursor: "pointer",
    lineHeight: 1,
    minHeight: 32,
  },
  empty: {
    padding: "2rem",
    textAlign: "center",
    color: "#A89880",
    fontSize: ".88rem",
  },
  anonymatBanner: {
    display: "flex",
    gap: ".7rem",
    alignItems: "flex-start",
    background: "#F5E6D5",
    border: "1px solid #E8A26A",
    borderRadius: 10,
    padding: ".75rem 1rem",
    fontSize: ".78rem",
    color: "#6B5E50",
    lineHeight: 1.55,
    marginTop: "1rem",
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(26,22,18,.55)",
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  modalBox: {
    background: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 460,
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(26,22,18,.18)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid #D8CFC0",
    fontSize: ".92rem",
    fontWeight: 600,
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "1rem",
    color: "#A89880",
  },
  modalBody: {
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: ".8rem",
  },
  modalFooter: {
    display: "flex",
    gap: ".5rem",
    justifyContent: "flex-end",
    padding: "1rem 1.25rem",
    borderTop: "1px solid #D8CFC0",
  },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".6rem" },
  fieldGroup: { display: "flex", flexDirection: "column", gap: ".3rem" },
  label: {
    fontSize: ".7rem",
    fontWeight: 600,
    color: "#6B5E50",
    textTransform: "uppercase",
    letterSpacing: ".07em",
  },
  field: {
    border: "1.5px solid #D8CFC0",
    borderRadius: 8,
    padding: ".55rem .8rem",
    fontSize: ".86rem",
    color: "#1A1612",
    background: "#F5F0E8",
    fontFamily: "inherit",
    minHeight: 42,
    outline: "none",
  },
};
