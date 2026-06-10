// backend/routes/criteria.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* ── GET /api/criteria  — accessible à tous les authentifiés (jurés ET admin) ── */
router.get("/", requireAuth, async (_req, res) => {
  const { data, error } = await supabase
    .from("criteria")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
