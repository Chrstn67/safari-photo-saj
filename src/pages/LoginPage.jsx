// frontend/src/pages/LoginPage.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../server/hooks/useAuth.jsx";

const ROLE_REDIRECT = {
  admin: "/admin",
  juror: "/jury",
  participant: "/participant",
  diapo: "/diapo",
};

export default function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>📸</div>
          <h1 style={styles.logoTitle}>Safari Photo</h1>
          <p style={styles.logoSub}>Concours de photographie</p>
        </div>

        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(tab === "login" ? styles.tabActive : {}),
            }}
            onClick={() => setTab("login")}
          >
            Se connecter
          </button>
          <button
            style={{
              ...styles.tab,
              ...(tab === "register" ? styles.tabActive : {}),
            }}
            onClick={() => setTab("register")}
          >
            S'inscrire
          </button>
        </div>

        {tab === "login" ? (
          <LoginForm login={login} navigate={navigate} />
        ) : (
          <RegisterForm
            register={register}
            navigate={navigate}
            setTab={setTab}
          />
        )}
      </div>
    </div>
  );
}

function LoginForm({ login, navigate }) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(
        form.firstName.trim(),
        form.lastName.trim(),
        form.password,
      );
      // Redirection basée sur le rôle
      const redirectPath = ROLE_REDIRECT[user.role] || "/participant";
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Prénom</label>
        <input
          style={styles.field}
          type="text"
          value={form.firstName}
          onChange={set("firstName")}
          required
          autoComplete="given-name"
          placeholder="Prénom"
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Nom</label>
        <input
          style={styles.field}
          type="text"
          value={form.lastName}
          onChange={set("lastName")}
          required
          autoComplete="family-name"
          placeholder="NOM"
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Mot de passe</label>
        <input
          style={styles.field}
          type="password"
          value={form.password}
          onChange={set("password")}
          required
          autoComplete="current-password"
        />
      </div>

      <button
        type="submit"
        style={{ ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}
        disabled={loading}
      >
        {loading ? "…" : "Se connecter →"}
      </button>
    </form>
  );
}

function RegisterForm({ register, navigate, setTab }) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    try {
      await register(
        form.firstName.trim(),
        form.lastName.trim(),
        form.password,
      );
      navigate("/participant", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.infoBanner}>
        <span style={{ fontSize: "1rem" }}>ℹ️</span>
        <span>
          Tu peux créer ton compte librement.
          <br />
          Si tu es juré ou organisateur, connecte-toi directement — tes accès
          ont été configurés.
        </span>
      </div>

      <div style={styles.row2}>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Prénom</label>
          <input
            style={styles.field}
            type="text"
            value={form.firstName}
            onChange={set("firstName")}
            required
            autoComplete="given-name"
          />
        </div>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Nom</label>
          <input
            style={styles.field}
            type="text"
            value={form.lastName}
            onChange={set("lastName")}
            required
            autoComplete="family-name"
          />
        </div>
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Mot de passe (6 caractères min.)</label>
        <input
          style={styles.field}
          type="password"
          value={form.password}
          onChange={set("password")}
          required
          minLength={6}
          autoComplete="new-password"
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Confirmer le mot de passe</label>
        <input
          style={styles.field}
          type="password"
          value={form.confirm}
          onChange={set("confirm")}
          required
          autoComplete="new-password"
        />
      </div>

      <button
        type="submit"
        style={{ ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}
        disabled={loading}
      >
        {loading ? "…" : "Créer mon compte →"}
      </button>

      <p
        style={{
          textAlign: "center",
          fontSize: ".78rem",
          color: "#6B5E50",
          marginTop: ".5rem",
        }}
      >
        Déjà inscrit ?{" "}
        <button
          type="button"
          onClick={() => setTab("login")}
          style={{
            background: "none",
            border: "none",
            color: "#C8611A",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: ".78rem",
          }}
        >
          Se connecter
        </button>
      </p>
    </form>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#F5F0E8",
    padding: "1rem",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    borderRadius: 16,
    border: "1px solid #D8CFC0",
    boxShadow: "0 4px 24px rgba(26,22,18,.10)",
    overflow: "hidden",
  },
  logo: {
    textAlign: "center",
    padding: "2rem 1.5rem 1rem",
  },
  logoIcon: { fontSize: "2.8rem", marginBottom: ".4rem" },
  logoTitle: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: "1.6rem",
    color: "#1A1612",
    marginBottom: ".2rem",
  },
  logoSub: { fontSize: ".84rem", color: "#6B5E50" },
  tabs: {
    display: "flex",
    borderBottom: "1.5px solid #D8CFC0",
  },
  tab: {
    flex: 1,
    padding: ".75rem",
    border: "none",
    background: "none",
    fontFamily: "inherit",
    fontSize: ".84rem",
    fontWeight: 500,
    color: "#A89880",
    cursor: "pointer",
    borderBottom: "2.5px solid transparent",
    marginBottom: -1.5,
    transition: "all .15s",
  },
  tabActive: {
    color: "#C8611A",
    borderBottomColor: "#C8611A",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: ".8rem",
    padding: "1.4rem 1.5rem 1.6rem",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: ".3rem",
  },
  row2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: ".6rem",
  },
  label: {
    fontSize: ".72rem",
    fontWeight: 600,
    color: "#6B5E50",
    textTransform: "uppercase",
    letterSpacing: ".07em",
  },
  field: {
    border: "1.5px solid #D8CFC0",
    borderRadius: 8,
    padding: ".6rem .85rem",
    fontSize: ".88rem",
    color: "#1A1612",
    background: "#F5F0E8",
    fontFamily: "inherit",
    transition: "border-color .15s",
    minHeight: 44,
    outline: "none",
  },
  btnPrimary: {
    background: "#C8611A",
    border: "none",
    borderRadius: 10,
    padding: ".75rem",
    color: "#fff",
    fontSize: ".9rem",
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    marginTop: ".25rem",
    minHeight: 46,
    transition: "filter .15s",
  },
  errorBanner: {
    background: "#F7E0DC",
    border: "1px solid #B84040",
    borderRadius: 8,
    padding: ".6rem .85rem",
    fontSize: ".8rem",
    color: "#B84040",
  },
  infoBanner: {
    display: "flex",
    gap: ".6rem",
    alignItems: "flex-start",
    background: "#F5E6D5",
    border: "1px solid #E8A26A",
    borderRadius: 8,
    padding: ".65rem .85rem",
    fontSize: ".78rem",
    color: "#6B5E50",
    lineHeight: 1.5,
  },
};
