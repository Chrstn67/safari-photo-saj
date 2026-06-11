// backend/routes/deliberations.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
import { shuffleArray } from "../utils/anonymize.js";
import { log } from "../utils/audit.js";

const router = express.Router();

/* ── GET /api/deliberations  — état de toutes les sessions AVEC URLs ── */
router.get("/", requireAuth, requireJuror, async (req, res) => {
  const { data, error } = await supabase
    .from("deliberation_sessions")
    .select(
      `
      *,
      categories(id, name, description),
      current_photo:submissions!current_photo_id(
        id, 
        anonymous_id, 
        display_order,
        photos(storage_path, filename)
      )
    `,
    )
    .order("created_at");

  if (error) return res.status(500).json({ error: error.message });

  // Ajouter les URLs signées pour chaque session
  const withUrls = await Promise.all(
    (data || []).map(async (session) => {
      let photoUrl = null;
      if (session.current_photo?.photos?.storage_path) {
        try {
          const { data: signed } = await supabase.storage
            .from("photos")
            .createSignedUrl(session.current_photo.photos.storage_path, 3600);
          photoUrl = signed?.signedUrl;
        } catch (err) {
          console.error("Erreur URL signée:", err);
        }
      }

      return {
        ...session,
        current_photo: session.current_photo
          ? {
              ...session.current_photo,
              url: photoUrl,
            }
          : null,
      };
    }),
  );

  res.json(withUrls);
});

/* ── GET /api/deliberations/active  — sessions actives UNIQUEMENT (pour jurés) ── */
router.get("/active", requireAuth, requireJuror, async (req, res) => {
  const { data, error } = await supabase
    .from("deliberation_sessions")
    .select(
      `
      *,
      categories(id, name, description),
      current_photo:submissions!current_photo_id(
        id, 
        anonymous_id, 
        display_order,
        photos(storage_path, filename)
      )
    `,
    )
    .eq("status", "open")
    .order("created_at");

  if (error) return res.status(500).json({ error: error.message });

  const withUrls = await Promise.all(
    (data || []).map(async (session) => {
      let photoUrl = null;
      if (session.current_photo?.photos?.storage_path) {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(session.current_photo.photos.storage_path, 3600);
        photoUrl = signed?.signedUrl;
      }

      return {
        ...session,
        current_photo: session.current_photo
          ? {
              ...session.current_photo,
              url: photoUrl,
            }
          : null,
      };
    }),
  );

  res.json(withUrls);
});

/* ── GET /api/deliberations/active  — sessions actives UNIQUEMENT ── */
router.get("/active", requireAuth, requireJuror, async (req, res) => {
  const { data, error } = await supabase
    .from("deliberation_sessions")
    .select(
      `
      *,
      categories(id, name, description),
      current_photo:submissions!current_photo_id(
        id, 
        anonymous_id, 
        display_order,
        photo:photos(storage_path, filename)
      )
    `,
    )
    .eq("status", "open")
    .order("created_at");

  if (error) return res.status(500).json({ error: error.message });

  // Ajouter les URLs signées
  const withUrls = await Promise.all(
    (data || []).map(async (session) => {
      let photoUrl = null;
      if (session.current_photo?.photo?.storage_path) {
        try {
          const { data: signed } = await supabase.storage
            .from("photos")
            .createSignedUrl(session.current_photo.photo.storage_path, 3600);
          photoUrl = signed?.signedUrl;
        } catch (err) {
          console.error("Erreur URL:", err.message);
        }
      }

      return {
        ...session,
        current_photo: session.current_photo
          ? {
              id: session.current_photo.id,
              anonymous_id: session.current_photo.anonymous_id,
              display_order: session.current_photo.display_order,
              url: photoUrl,
            }
          : null,
      };
    }),
  );

  res.json(withUrls);
});

/* ── POST /api/deliberations/open  — ouvrir une catégorie ── */
router.post("/open", requireAuth, requireAdmin, async (req, res) => {
  const { categoryId } = req.body;
  if (!categoryId) return res.status(400).json({ error: "categoryId requis" });

  try {
    const { data: subs, error: subErr } = await supabase
      .from("submissions")
      .select("id")
      .eq("category_id", categoryId);

    if (subErr) throw subErr;
    if (!subs?.length) {
      return res
        .status(400)
        .json({ error: "Aucune soumission dans cette catégorie" });
    }

    const shuffled = shuffleArray(subs.map((s) => s.id));

    // Assigne display_order
    for (let i = 0; i < shuffled.length; i++) {
      await supabase
        .from("submissions")
        .update({ display_order: i + 1 })
        .eq("id", shuffled[i]);
    }

    const { data: session, error: sessErr } = await supabase
      .from("deliberation_sessions")
      .upsert(
        {
          category_id: categoryId,
          current_photo_id: shuffled[0],
          status: "open",
          opened_at: new Date().toISOString(),
          created_by: req.user.id,
        },
        { onConflict: "category_id" },
      )
      .select()
      .single();

    if (sessErr) throw sessErr;

    await log(req.user.id, "DELIB_OPEN", "deliberation_sessions", session.id, {
      categoryId,
    });
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/deliberations/next  — photo suivante ── */
router.post("/next", requireAuth, requireJuror, async (req, res) => {
  const { categoryId, forced = false } = req.body;

  try {
    if (forced && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Seul l'admin peut forcer le passage" });
    }

    const { data: session } = await supabase
      .from("deliberation_sessions")
      .select(
        "*, current_photo:submissions!current_photo_id(id, display_order)",
      )
      .eq("category_id", categoryId)
      .single();

    if (!session || session.status !== "open") {
      return res.status(400).json({ error: "Session non ouverte" });
    }

    const currentOrder = session.current_photo?.display_order || 0;

    // Vérification des validations (sauf si forcé)
    if (!forced) {
      const { data: allJurors } = await supabase
        .from("users")
        .select("id")
        .in("role_id", [2, 3]); // jurés + admins

      const { data: validations } = await supabase
        .from("jury_validations")
        .select("juror_id")
        .eq("submission_id", session.current_photo_id);

      const validatedIds = (validations || []).map((v) => v.juror_id);
      const allValidated = (allJurors || []).every((j) =>
        validatedIds.includes(j.id),
      );

      if (!allValidated) {
        return res.status(400).json({
          error: "Tous les jurés n'ont pas encore validé",
          allValidated: false,
          remainingJurors: (allJurors || []).filter(
            (j) => !validatedIds.includes(j.id),
          ).length,
        });
      }
    }

    // Photo suivante
    const { data: nextPhoto } = await supabase
      .from("submissions")
      .select("id, display_order")
      .eq("category_id", categoryId)
      .gt("display_order", currentOrder)
      .order("display_order", { ascending: true })
      .limit(1)
      .single();

    if (!nextPhoto) {
      const { data: closed } = await supabase
        .from("deliberation_sessions")
        .update({ status: "completed", closed_at: new Date().toISOString() })
        .eq("category_id", categoryId)
        .select()
        .single();

      await log(
        req.user.id,
        "DELIB_COMPLETE",
        "deliberation_sessions",
        session.id,
        { categoryId },
      );
      return res.json({ done: true, session: closed });
    }

    const { data: updated } = await supabase
      .from("deliberation_sessions")
      .update({ current_photo_id: nextPhoto.id })
      .eq("category_id", categoryId)
      .select()
      .single();

    res.json({ done: false, session: updated, nextPhotoId: nextPhoto.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/deliberations/close  — fermer ── */
router.post("/close", requireAuth, requireAdmin, async (req, res) => {
  const { categoryId } = req.body;
  const { data, error } = await supabase
    .from("deliberation_sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("category_id", categoryId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await log(req.user.id, "DELIB_CLOSE", "deliberation_sessions", data.id);
  res.json(data);
});

/* ── POST /api/deliberations/reset  — réinitialiser ── */
router.post("/reset", requireAuth, requireAdmin, async (req, res) => {
  const { categoryId } = req.body;
  try {
    const { data: subs } = await supabase
      .from("submissions")
      .select("id")
      .eq("category_id", categoryId);

    const subIds = (subs || []).map((s) => s.id);

    if (subIds.length) {
      await supabase.from("scores").delete().in("submission_id", subIds);
      await supabase
        .from("jury_validations")
        .delete()
        .in("submission_id", subIds);
      await supabase.from("favorites").delete().eq("category_id", categoryId);
    }

    await supabase
      .from("deliberation_sessions")
      .update({
        status: "pending",
        current_photo_id: null,
        opened_at: null,
        closed_at: null,
      })
      .eq("category_id", categoryId);

    await log(req.user.id, "DELIB_RESET", "deliberation_sessions", null, {
      categoryId,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/deliberations/:categoryId/validations  ── */
router.get(
  "/:categoryId/validations",
  requireAuth,
  requireJuror,
  async (req, res) => {
    const { categoryId } = req.params;

    const { data: session } = await supabase
      .from("deliberation_sessions")
      .select("current_photo_id")
      .eq("category_id", categoryId)
      .single();

    if (!session) return res.json({ validations: [], currentPhotoId: null });

    const { data: validations } = await supabase
      .from("jury_validations")
      .select("juror_id, validated_at, users(first_name, last_name)")
      .eq("submission_id", session.current_photo_id);

    const { data: allJurors } = await supabase
      .from("users")
      .select("id, first_name, last_name")
      .in("role_id", [2, 3]);

    const validatedIds = (validations || []).map((v) => v.juror_id);
    const result = (allJurors || []).map((j) => ({
      jurorId: j.id,
      name: `${j.first_name} ${j.last_name}`,
      validated: validatedIds.includes(j.id),
      validatedAt:
        validations?.find((v) => v.juror_id === j.id)?.validated_at || null,
    }));

    res.json({ validations: result, currentPhotoId: session.current_photo_id });
  },
);

/* ── DELETE /api/deliberations/session/:categoryId  — Supprimer une session de délibération ── */
router.delete(
  "/session/:categoryId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { categoryId } = req.params;

    if (!categoryId) {
      return res.status(400).json({ error: "categoryId requis" });
    }

    try {
      // 1. Récupérer toutes les soumissions de cette catégorie
      const { data: submissions, error: subError } = await supabase
        .from("submissions")
        .select("id, photo_id")
        .eq("category_id", categoryId);

      if (subError) throw subError;

      const submissionIds = (submissions || []).map((s) => s.id);
      const photoIds = (submissions || []).map((s) => s.photo_id);

      // 2. Supprimer les scores liés à ces soumissions
      if (submissionIds.length > 0) {
        const { error: scoresError } = await supabase
          .from("scores")
          .delete()
          .in("submission_id", submissionIds);

        if (scoresError) throw scoresError;

        // 3. Supprimer les validations des jurés
        const { error: validationsError } = await supabase
          .from("jury_validations")
          .delete()
          .in("submission_id", submissionIds);

        if (validationsError) throw validationsError;

        // 4. Supprimer les favoris/coups de cœur
        const { error: favoritesError } = await supabase
          .from("favorites")
          .delete()
          .in("submission_id", submissionIds);

        if (favoritesError) throw favoritesError;

        // 5. Supprimer les résultats calculés
        const { error: resultsError } = await supabase
          .from("results")
          .delete()
          .in("submission_id", submissionIds);

        if (resultsError) throw resultsError;

        // 6. Supprimer les soumissions
        const { error: deleteSubError } = await supabase
          .from("submissions")
          .delete()
          .eq("category_id", categoryId);

        if (deleteSubError) throw deleteSubError;
      }

      // 7. Mettre à jour les photos : les marquer comme non soumises
      if (photoIds.length > 0) {
        const { error: photosError } = await supabase
          .from("photos")
          .update({ is_submitted: false })
          .in("id", photoIds);

        if (photosError) throw photosError;
      }

      // 8. Supprimer ou réinitialiser la session de délibération
      const { error: sessionError } = await supabase
        .from("deliberation_sessions")
        .delete()
        .eq("category_id", categoryId);

      if (sessionError) throw sessionError;

      // 9. Journaliser l'action
      await log(
        req.user.id,
        "DELIB_SESSION_DELETED",
        "deliberation_sessions",
        null,
        {
          categoryId,
          submissionsDeleted: submissionIds.length,
          photosReset: photoIds.length,
        },
      );

      res.json({
        success: true,
        message: `Session supprimée : ${submissionIds.length} soumission(s) réinitialisée(s)`,
        deletedCount: submissionIds.length,
      });
    } catch (e) {
      console.error("[DELETE_SESSION] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

export default router;
