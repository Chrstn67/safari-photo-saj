// api/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

// Importez vos routes
import authRoutes from "../server/routes/auth.js";
import photosRoutes from "../server/routes/photos.js";
import categoriesRoutes from "../server/routes/categories.js";
import criteriaRoutes from "../server/routes/criteria.js";
import deliberationsRoutes from "../server/routes/deliberations.js";
import scoresRoutes from "../server/routes/scores.js";
import resultsRoutes from "../server/routes/results.js";
import adminRoutes from "../server/routes/admin.js";

dotenv.config();

const app = express();

// Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "https://votre-projet.vercel.app",
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Routes API
app.use("/api/auth", authRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/criteria", criteriaRoutes);
app.use("/api/deliberations", deliberationsRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Export pour Vercel
export default app;
