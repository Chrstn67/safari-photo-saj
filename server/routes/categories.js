// backend/routes/categories.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* ── GET /api/categories  ── */
router.get("/", requireAuth, async (_req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, description, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ── GET /api/categories/:id/current-photo  ── */
router.get("/:id/current-photo", requireAuth, async (req, res) => {
  if (!["juror", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Réservé au jury" });
  }

  // Récupérer la session avec la photo
  const { data: session, error: sessionErr } = await supabase
    .from("deliberation_sessions")
    .select(
      `
      status,
      current_photo_id,
      current_photo:submissions!current_photo_id(
        id, 
        anonymous_id, 
        display_order,
        photo:photos(
          storage_path, 
          size_bytes,
          filename
        )
      )
    `,
    )
    .eq("category_id", req.params.id)
    .single();

  if (sessionErr || !session) {
    return res.json({ status: "pending", photo: null });
  }

  if (session.status !== "open") {
    return res.json({ status: session.status, photo: null });
  }

  if (!session.current_photo) {
    return res.json({ status: session.status, photo: null });
  }

  // Générer l'URL signée
  let url = null;
  const storagePath = session.current_photo.photo?.storage_path;
  if (storagePath) {
    try {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(storagePath, 3600);
      url = signed?.signedUrl;
    } catch (err) {
      console.error("Erreur URL signée:", err.message);
    }
  }

  res.json({
    status: session.status,
    photo: {
      id: session.current_photo.id,
      anonymous_id: session.current_photo.anonymous_id,
      display_order: session.current_photo.display_order,
      url: url,
    },
  });
});

/* ── GET /api/categories/:id/slideshow ── */
router.get("/:id/slideshow", requireAuth, async (req, res) => {
  if (!["juror", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Accès réservé" });
  }

  const { data: session } = await supabase
    .from("deliberation_sessions")
    .select(
      `
      status,
      current_photo:submissions!current_photo_id(
        id, 
        anonymous_id, 
        display_order,
        photo:photos(storage_path)
      )
    `,
    )
    .eq("category_id", req.params.id)
    .single();

  if (!session?.current_photo?.photo) {
    return res.json({
      photoUrl: null,
      anonymousId: null,
      displayOrder: null,
      status: session?.status || "pending",
    });
  }

  let url = null;
  const storagePath = session.current_photo.photo.storage_path;
  if (storagePath) {
    const { data: signed } = await supabase.storage
      .from("photos")
      .createSignedUrl(storagePath, 3600);
    url = signed?.signedUrl;
  }

  res.json({
    photoUrl: url,
    anonymousId: session.current_photo.anonymous_id,
    displayOrder: session.current_photo.display_order,
    status: session.status,
  });
});

export default router;
