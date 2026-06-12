// server/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

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

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "https://safari-photo.vercel.app",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ROUTES - Vérifiez que chaque route est bien enregistrée
app.use("/api/auth", authRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/criteria", criteriaRoutes);
app.use("/api/deliberations", deliberationsRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/slideshow", slideshowRoutes);
app.use("/api/admin", adminRoutes);

// Route de debug pour voir toutes les routes enregistrées
app.get("/api/routes", (_req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push(
        `${Object.keys(middleware.route.methods)} ${middleware.route.path}`,
      );
    } else if (middleware.name === "router") {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push(
            `${Object.keys(handler.route.methods)} ${handler.route.path}`,
          );
        }
      });
    }
  });
  res.json({ routes });
});

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

// Pour Vercel serverless
export default function handler(req, res) {
  app(req, res);
}
