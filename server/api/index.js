// backend/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

import authRoutes from "../routes/auth.js";
import photosRoutes from "../routes/photos.js";
import categoriesRoutes from "../routes/categories.js";
import criteriaRoutes from "../routes/criteria.js";
import deliberationsRoutes from "../routes/deliberations.js";
import scoresRoutes from "../routes/scores.js";
import resultsRoutes from "../routes/results.js";
import slideshowRoutes from "../routes/slideshow.js"; // ← IMPORTANT : ajouté
import adminRoutes from "../routes/admin.js";

dotenv.config();

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "https://safari-photo.vercel.app",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/criteria", criteriaRoutes);
app.use("/api/deliberations", deliberationsRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/slideshow", slideshowRoutes); // ← AJOUTÉ
app.use("/api/admin", adminRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/api/debug-env", (_req, res) => {
  res.json({
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwt_secret: !!process.env.JWT_SECRET,
    frontend_url: process.env.FRONTEND_URL,
  });
});

export default function handler(req, res) {
  app(req, res);
}
