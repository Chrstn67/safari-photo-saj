// backend/server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import photosRoutes from "./routes/photos.js";
import categoriesRoutes from "./routes/categories.js";
import criteriaRoutes from "./routes/criteria.js";
import deliberationsRoutes from "./routes/deliberations.js";
import scoresRoutes from "./routes/scores.js";
import resultsRoutes from "./routes/results.js";
import slideshowRoutes from "./routes/slideshow.js";
import adminRoutes from "./routes/admin.js";

dotenv.config();

const app = express();

/* ── Sécurité de base ── */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // pour les images signées
  }),
);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* ── Rate limiting (désactivé, gardé pour référence) ── */
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 min
//   max: 200,
//   message: { error: "Trop de requêtes, réessayez dans 15 minutes" },
// });
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 20, // plus strict pour login/register
//   message: { error: "Trop de tentatives de connexion" },
// });

// app.use("/api/", limiter);
// app.use("/api/auth", authLimiter);

/* ── Routes ── */
app.use("/api/auth", authRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/criteria", criteriaRoutes);
app.use("/api/deliberations", deliberationsRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/slideshow", slideshowRoutes);

/* ── Health check ── */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() }),
);

/* ── 404 ── */
app.use((_req, res) => res.status(404).json({ error: "Route introuvable" }));

/* ── Erreur globale ── */
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: `Fichier trop lourd (max ${process.env.MAX_FILE_SIZE_MB || 20} Mo)`,
    });
  }
  res.status(500).json({ error: err.message || "Erreur serveur" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🦁 Safari Photo API  →  http://localhost:${PORT}`);
});
