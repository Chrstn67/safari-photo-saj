// backend/routes/admin.js
// ═══════════════════════════════════════════════════════════════
// RÈGLE D'OR ANONYMAT (rappel pour tout développeur)
//
// L'admin VOIT :
//   ✅ La liste des inscrits (prénom, nom, rôle)
//   ✅ Qui est juré / qui est participant
//   ✅ Les scores globaux APRÈS publication
//
// L'admin NE VOIT JAMAIS :
//   ❌ À qui appartient une photo pendant les délibérations
//   ❌ Le lien submission.user_id → nom en dehors du palmarès publié
// ═══════════════════════════════════════════════════════════════

import express from "express";
import bcrypt from "bcryptjs";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

router.use(requireAuth, requireAdmin);

/* ════════════════════════════════════════════════════════════════
   UTILISATEURS
════════════════════════════════════════════════════════════════ */

/* GET /api/admin/users */
router.get("/users", async (_req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, first_name, last_name, role_id, is_active, created_at, roles(name)",
    )
    .order("role_id")
    .order("last_name");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* POST /api/admin/users */
router.post("/users", async (req, res) => {
  const { firstName, lastName, password, roleId } = req.body;

  if (!firstName?.trim() || !lastName?.trim() || !password || !roleId) {
    return res.status(400).json({ error: "Tous les champs sont requis" });
  }
  if (![1, 2, 3].includes(parseInt(roleId))) {
    return res
      .status(400)
      .json({ error: "Rôle invalide (1=participant, 2=juré, 3=admin)" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from("users")
    .insert({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      password_hash: passwordHash,
      role_id: parseInt(roleId),
    })
    .select("id, first_name, last_name, role_id")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await log(req.user.id, "ADMIN_CREATE_USER", "users", data.id, {
    targetName: `${data.first_name} ${data.last_name}`,
    roleId,
  });
  res.status(201).json(data);
});

/* PATCH /api/admin/users/:id/role - Modifier le rôle UNIQUEMENT */
router.patch("/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { roleId } = req.body;

  console.log("[PATCH /role] id:", id, "roleId:", roleId);

  if (![1, 2, 3].includes(parseInt(roleId))) {
    return res.status(400).json({ error: "Rôle invalide" });
  }
  if (id === req.user.id && parseInt(roleId) !== 3) {
    return res.status(400).json({
      error: "Vous ne pouvez pas rétrograder votre propre compte admin",
    });
  }

  const { data: before } = await supabase
    .from("users")
    .select("role_id, first_name, last_name")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("users")
    .update({ role_id: parseInt(roleId) })
    .eq("id", id)
    .select("id, first_name, last_name, role_id")
    .single();

  if (error) {
    console.error("[PATCH /role] Error:", error);
    return res.status(500).json({ error: error.message });
  }

  await log(req.user.id, "ADMIN_CHANGE_ROLE", "users", id, {
    from: before?.role_id,
    to: roleId,
    targetName: `${data.first_name} ${data.last_name}`,
  });
  res.json(data);
});

/* PUT /api/admin/users/:id - Modifier infos générales (sans rôle) */
router.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, isActive, password } = req.body;
  const updates = {};

  console.log("[PUT /users/:id] id:", id, req.body);

  if (firstName !== undefined) updates.first_name = firstName.trim();
  if (lastName !== undefined) updates.last_name = lastName.trim();
  if (isActive !== undefined) updates.is_active = isActive;
  if (password && password.length >= 6) {
    updates.password_hash = await bcrypt.hash(password, 12);
  }

  // Ne pas modifier le rôle ici
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", id)
    .select("id, first_name, last_name, role_id, is_active")
    .single();

  if (error) {
    console.error("[PUT /users/:id] Error:", error);
    return res.status(500).json({ error: error.message });
  }

  await log(req.user.id, "ADMIN_UPDATE_USER", "users", id, {
    fields: Object.keys(updates).filter((k) => k !== "password_hash"),
  });
  res.json(data);
});

/* DELETE /api/admin/users/:id - Suppression complète */
router.delete("/users/:id", async (req, res) => {
  const { id } = req.params;

  console.log("[DELETE /users/:id] id:", id);

  if (id === req.user.id) {
    return res
      .status(400)
      .json({ error: "Impossible de supprimer votre propre compte" });
  }

  try {
    // 1. Récupérer toutes les soumissions de l'utilisateur
    const { data: submissions } = await supabase
      .from("submissions")
      .select("id, photo_id")
      .eq("user_id", id);

    const submissionIds = (submissions || []).map((s) => s.id);
    const photoIds = (submissions || []).map((s) => s.photo_id);

    // 2. Mettre à jour les sessions de délibération
    if (submissionIds.length > 0) {
      const { data: sessionsToUpdate } = await supabase
        .from("deliberation_sessions")
        .select("id, category_id")
        .in("current_photo_id", submissionIds);

      if (sessionsToUpdate && sessionsToUpdate.length > 0) {
        for (const session of sessionsToUpdate) {
          const { data: otherSubmission } = await supabase
            .from("submissions")
            .select("id")
            .eq("category_id", session.category_id)
            .not("id", "in", `(${submissionIds.join(",")})`)
            .limit(1)
            .single();

          if (otherSubmission) {
            await supabase
              .from("deliberation_sessions")
              .update({ current_photo_id: otherSubmission.id })
              .eq("id", session.id);
          } else {
            await supabase
              .from("deliberation_sessions")
              .update({
                status: "closed",
                closed_at: new Date().toISOString(),
                current_photo_id: null,
              })
              .eq("id", session.id);
          }
        }
      }
    }

    // 3. Supprimer les dépendances
    if (submissionIds.length > 0) {
      await supabase.from("scores").delete().in("submission_id", submissionIds);
      await supabase
        .from("jury_validations")
        .delete()
        .in("submission_id", submissionIds);
      await supabase
        .from("favorites")
        .delete()
        .in("submission_id", submissionIds);
      await supabase.from("notes").delete().in("submission_id", submissionIds);
      await supabase
        .from("results")
        .delete()
        .in("submission_id", submissionIds);
    }

    // 4. Supprimer les scores où l'utilisateur est juré
    await supabase.from("scores").delete().eq("juror_id", id);
    await supabase.from("jury_validations").delete().eq("juror_id", id);
    await supabase.from("favorites").delete().eq("juror_id", id);
    await supabase.from("notes").delete().eq("juror_id", id);

    // 5. Supprimer les soumissions
    await supabase.from("submissions").delete().eq("user_id", id);

    // 6. Supprimer les photos du storage
    const { data: photos } = await supabase
      .from("photos")
      .select("storage_path")
      .eq("user_id", id);

    if (photos && photos.length > 0) {
      const storagePaths = photos.map((p) => p.storage_path).filter((p) => p);
      if (storagePaths.length > 0) {
        await supabase.storage.from("photos").remove(storagePaths);
      }
    }

    // 7. Supprimer les photos
    await supabase.from("photos").delete().eq("user_id", id);

    // 8. Supprimer l'audit log
    await supabase.from("audit_log").delete().eq("user_id", id);

    // 9. Supprimer l'utilisateur
    const { error } = await supabase.from("users").delete().eq("id", id);

    if (error) throw error;

    await log(req.user.id, "ADMIN_DELETE_USER", "users", id, {
      submissionsDeleted: submissionIds.length,
      photosDeleted: photos?.length || 0,
    });

    res.json({ success: true, message: "Utilisateur supprimé" });
  } catch (error) {
    console.error("[DELETE] Erreur:", error);
    res.status(500).json({ error: error.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   CATÉGORIES
════════════════════════════════════════════════════════════════ */
router.get("/categories", async (_req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post("/categories", async (req, res) => {
  const { name, description, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
  const { data, error } = await supabase
    .from("categories")
    .insert({ name: name.trim(), description, sort_order: sortOrder || 0 })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await log(req.user.id, "ADMIN_CREATE_CATEGORY", "categories", data.id);
  res.status(201).json(data);
});

router.put("/categories/:id", async (req, res) => {
  const { id } = req.params;
  const updates = {};
  if (req.body.name !== undefined) updates.name = req.body.name.trim();
  if (req.body.description !== undefined)
    updates.description = req.body.description;
  if (req.body.isActive !== undefined) updates.is_active = req.body.isActive;
  if (req.body.sortOrder !== undefined) updates.sort_order = req.body.sortOrder;

  const { data, error } = await supabase
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/categories/:id", async (req, res) => {
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

/* POST /api/admin/categories/:id/reset */
router.post("/categories/:id/reset", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: category, error: catError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("id", id)
      .single();

    if (catError || !category) {
      return res.status(404).json({ error: "Catégorie introuvable" });
    }

    const { data: submissions, error: subError } = await supabase
      .from("submissions")
      .select("id, photo_id")
      .eq("category_id", id);

    if (subError) throw subError;

    const submissionIds = (submissions || []).map((s) => s.id);
    const photoIds = (submissions || []).map((s) => s.photo_id);

    if (submissionIds.length > 0) {
      await supabase.from("scores").delete().in("submission_id", submissionIds);
      await supabase
        .from("jury_validations")
        .delete()
        .in("submission_id", submissionIds);
      await supabase
        .from("favorites")
        .delete()
        .in("submission_id", submissionIds);
      await supabase
        .from("results")
        .delete()
        .in("submission_id", submissionIds);
    }

    await supabase.from("submissions").delete().eq("category_id", id);

    if (photoIds.length > 0) {
      await supabase
        .from("photos")
        .update({ is_submitted: false })
        .in("id", photoIds);
    }

    await supabase.from("deliberation_sessions").delete().eq("category_id", id);

    await log(req.user.id, "CATEGORY_RESET", "categories", id, {
      categoryName: category.name,
      submissionsReset: submissionIds.length,
    });

    res.json({
      success: true,
      message: `Catégorie "${category.name}" réinitialisée`,
    });
  } catch (e) {
    console.error("[CATEGORY_RESET] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   CRITÈRES
════════════════════════════════════════════════════════════════ */
router.get("/criteria", async (_req, res) => {
  const { data, error } = await supabase
    .from("criteria")
    .select("*")
    .order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post("/criteria", async (req, res) => {
  const { name, description, icon, maxPoints, weight, sortOrder } = req.body;
  const { data, error } = await supabase
    .from("criteria")
    .insert({
      name,
      description,
      icon: icon || "📷",
      max_points: maxPoints || 5,
      weight: weight || 1,
      sort_order: sortOrder || 0,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put("/criteria/:id", async (req, res) => {
  const { id } = req.params;
  const updates = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.description !== undefined)
    updates.description = req.body.description;
  if (req.body.icon !== undefined) updates.icon = req.body.icon;
  if (req.body.maxPoints !== undefined) updates.max_points = req.body.maxPoints;
  if (req.body.weight !== undefined) updates.weight = req.body.weight;
  if (req.body.isActive !== undefined) updates.is_active = req.body.isActive;
  const { data, error } = await supabase
    .from("criteria")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/criteria/:id", async (req, res) => {
  const { error } = await supabase
    .from("criteria")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════════════════════════ */
router.get("/dashboard", async (_req, res) => {
  const [users, photos, submissions, sessions, results] = await Promise.all([
    supabase.from("users").select("role_id"),
    supabase.from("photos").select("*", { count: "exact", head: true }),
    supabase.from("submissions").select("*", { count: "exact", head: true }),
    supabase.from("deliberation_sessions").select("status, categories(name)"),
    supabase.from("results").select("is_published").limit(1).maybeSingle(),
  ]);

  const roleMap = { 1: 0, 2: 0, 3: 0 };
  (users.data || []).forEach((u) => {
    roleMap[u.role_id] = (roleMap[u.role_id] || 0) + 1;
  });

  res.json({
    participants: roleMap[1],
    jurors: roleMap[2],
    admins: roleMap[3],
    totalPhotos: photos.count || 0,
    totalSubmissions: submissions.count || 0,
    sessions: sessions.data || [],
    resultsPublished: results.data?.is_published || false,
  });
});

/* ════════════════════════════════════════════════════════════════
   PHOTOS ADMIN
════════════════════════════════════════════════════════════════ */
router.get("/photos", async (_req, res) => {
  const { data: pub } = await supabase
    .from("results")
    .select("is_published")
    .eq("is_published", true)
    .limit(1)
    .maybeSingle();

  const query = supabase
    .from("photos")
    .select(
      pub
        ? "*, users(first_name, last_name)"
        : "id, filename, mime_type, size_bytes, is_submitted, created_at",
    )
    .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/photos/:id", async (req, res) => {
  const { id } = req.params;
  const { data: photo } = await supabase
    .from("photos")
    .select("storage_path, is_submitted")
    .eq("id", id)
    .single();
  if (photo?.is_submitted) {
    return res
      .status(403)
      .json({ error: "Impossible de supprimer une photo soumise" });
  }
  if (photo) await supabase.storage.from("photos").remove([photo.storage_path]);
  await supabase.from("photos").delete().eq("id", id);
  await log(req.user.id, "ADMIN_DELETE_PHOTO", "photos", id);
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════════
   AUDIT LOG
════════════════════════════════════════════════════════════════ */
router.get("/audit", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "100"), 500);
  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, action, entity, entity_id, details, created_at, users(first_name, last_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
