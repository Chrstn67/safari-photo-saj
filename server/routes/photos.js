// backend/routes/photos.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { upload, processAndStore, getSignedUrl } from "../middleware/upload.js";
import { generateAnonymousId } from "../utils/anonymize.js";
import { log } from "../utils/audit.js";

const router = express.Router();

/* ── GET /api/photos  — banque personnelle ── */
router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Générer des URLs signées pour chaque photo
  const withUrls = await Promise.all(
    data.map(async (p) => {
      try {
        const url = await getSignedUrl(p.storage_path, 3600);
        return { ...p, url };
      } catch {
        return { ...p, url: null };
      }
    }),
  );
  res.json(withUrls);
});

/* ── POST /api/photos  — upload dans la banque ── */
router.post("/", requireAuth, upload.single("photo"), async (req, res) => {
  if (!["participant"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ error: "Seuls les participants peuvent uploader des photos" });
  }
  if (!req.file) return res.status(400).json({ error: "Fichier manquant" });

  try {
    const { storagePath, sizeBytes, mimeType } = await processAndStore(
      req.file.buffer,
      req.file.originalname,
      req.user.id,
    );

    const { data: photo, error } = await supabase
      .from("photos")
      .insert({
        user_id: req.user.id,
        filename: storagePath.split("/").pop(),
        original_name: req.file.originalname,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        storage_path: storagePath,
        is_submitted: false,
      })
      .select()
      .single();

    if (error) throw error;

    await log(req.user.id, "PHOTO_UPLOAD", "photos", photo.id);
    const url = await getSignedUrl(storagePath, 3600);
    res.status(201).json({ ...photo, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── DELETE /api/photos/:id  — suppression banque (non soumise seulement) ── */
router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data: photo, error } = await supabase
    .from("photos")
    .select("*")
    .eq("id", id)
    .eq("user_id", req.user.id)
    .single();

  if (error || !photo)
    return res.status(404).json({ error: "Photo introuvable" });
  if (photo.is_submitted)
    return res
      .status(403)
      .json({ error: "Impossible de supprimer une photo soumise" });

  // Supprimer du Storage
  await supabase.storage.from("photos").remove([photo.storage_path]);

  const { error: delErr } = await supabase.from("photos").delete().eq("id", id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  await log(req.user.id, "PHOTO_DELETE", "photos", id);
  res.json({ success: true });
});

/* ── POST /api/photos/:id/submit  — soumettre à une catégorie ── */
router.post("/:id/submit", requireAuth, async (req, res) => {
  if (req.user.role !== "participant") {
    return res.status(403).json({ error: "Réservé aux participants" });
  }

  const { id } = req.params;
  const { categoryId } = req.body;

  if (!categoryId) return res.status(400).json({ error: "categoryId requis" });

  try {
    // La photo appartient bien à ce participant et n'est pas déjà soumise
    const { data: photo } = await supabase
      .from("photos")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user.id)
      .single();

    if (!photo) return res.status(404).json({ error: "Photo introuvable" });
    if (photo.is_submitted)
      return res.status(400).json({ error: "Déjà soumise" });

    // Vérifie qu'il n'a pas déjà soumis dans cette catégorie
    const { data: existing } = await supabase
      .from("submissions")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("category_id", categoryId)
      .single();

    if (existing)
      return res
        .status(409)
        .json({
          error: "Vous avez déjà soumis une photo dans cette catégorie",
        });

    // Catégorie active ?
    const { data: cat } = await supabase
      .from("categories")
      .select("id, name, is_active")
      .eq("id", categoryId)
      .single();

    if (!cat?.is_active)
      return res.status(400).json({ error: "Catégorie inactive" });

    // Génère l'ID anonyme
    const { count } = await supabase
      .from("submissions")
      .select("*", { count: "exact", head: true });
    const anonId = generateAnonymousId((count || 0) + 1, cat.name);

    // Transaction : marquer photo + créer soumission
    const { data: sub, error: subErr } = await supabase
      .from("submissions")
      .insert({
        photo_id: photo.id,
        user_id: req.user.id,
        category_id: categoryId,
        anonymous_id: anonId,
      })
      .select()
      .single();

    if (subErr) throw subErr;

    await supabase.from("photos").update({ is_submitted: true }).eq("id", id);

    await log(req.user.id, "PHOTO_SUBMIT", "submissions", sub.id, {
      categoryId,
      anonId,
    });
    res.status(201).json(sub);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/photos/admin/all  — admin : voir toutes les photos ── */
router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("photos")
    .select("*, users(first_name, last_name)")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
