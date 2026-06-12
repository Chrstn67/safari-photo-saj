// backend/routes/slideshow.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireDiapo } from "../middleware/auth.js";

const router = express.Router();

// ⚠️ TOUTES les routes slideshow sont protégées par le rôle "diapo"
// Pour que l'écran public fonctionne, il faut créer un utilisateur avec role_id=4
// ET que cet utilisateur soit connecté pour afficher le diaporama.

// GET /api/slideshow/status
router.get("/status", requireAuth, requireDiapo, async (req, res) => {
  try {
    // Vérifier s'il y a une session ouverte
    const { data: openSession } = await supabase
      .from("deliberation_sessions")
      .select("id, category_id, status, current_photo_id, categories(name)")
      .eq("status", "open")
      .maybeSingle();

    // Vérifier s'il y a une session terminée
    const { data: completedSession } = await supabase
      .from("deliberation_sessions")
      .select("id, category_id, status")
      .eq("status", "completed")
      .maybeSingle();

    // Vérifier si les résultats sont publiés
    const { data: resultsStatus } = await supabase
      .from("results")
      .select("is_published")
      .limit(1)
      .maybeSingle();

    res.json({
      hasOpenSession: !!openSession,
      openSession: openSession
        ? {
            id: openSession.id,
            categoryId: openSession.category_id,
            categoryName: openSession.categories?.name,
            hasCurrentPhoto: !!openSession.current_photo_id,
          }
        : null,
      hasCompletedSession: !!completedSession,
      resultsPublished: resultsStatus?.is_published || false,
    });
  } catch (e) {
    console.error("[SLIDESHOW_STATUS]", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slideshow/current
router.get("/current", requireAuth, requireDiapo, async (req, res) => {
  try {
    const { data: openSession } = await supabase
      .from("deliberation_sessions")
      .select(
        `
        id,
        category_id,
        status,
        current_photo_id,
        categories!deliberation_sessions_category_id_fkey (name),
        current_photo:submissions!current_photo_id (
          id,
          anonymous_id,
          display_order,
          photo_id,
          photos:photo_id (storage_path)
        )
      `,
      )
      .eq("status", "open")
      .maybeSingle();

    if (
      !openSession ||
      !openSession.current_photo_id ||
      !openSession.current_photo
    ) {
      return res.json({ hasPhoto: false, photo: null, category: null });
    }

    const storagePath = openSession.current_photo.photos?.storage_path;
    if (!storagePath) {
      return res.json({ hasPhoto: false, photo: null, category: null });
    }

    let url = null;
    try {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(storagePath, 3600);
      url = signed?.signedUrl;
    } catch (err) {
      console.error("[SLIDESHOW] URL signed error:", err);
    }

    res.json({
      hasPhoto: true,
      photo: {
        id: openSession.current_photo.id,
        url: url,
        anonymous_id: openSession.current_photo.anonymous_id,
        display_order: openSession.current_photo.display_order,
      },
      category: openSession.categories?.name || null,
    });
  } catch (e) {
    console.error("[SLIDESHOW_CURRENT]", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slideshow/all-photos/:categoryId
router.get(
  "/all-photos/:categoryId",
  requireAuth,
  requireDiapo,
  async (req, res) => {
    const { categoryId } = req.params;

    try {
      const { data: submissions, error } = await supabase
        .from("submissions")
        .select(
          `
        id,
        display_order,
        photos!submissions_photo_id_fkey (storage_path)
      `,
        )
        .eq("category_id", categoryId)
        .order("display_order", { ascending: true });

      if (error || !submissions?.length) {
        return res.json({ photos: [] });
      }

      const photosWithUrls = await Promise.all(
        submissions.map(async (sub, idx) => {
          let url = null;
          const storagePath = sub.photos?.storage_path;
          if (storagePath) {
            try {
              const { data: signed } = await supabase.storage
                .from("photos")
                .createSignedUrl(storagePath, 3600);
              url = signed?.signedUrl;
            } catch (err) {}
          }
          return {
            id: sub.id,
            url: url,
            displayOrder: sub.display_order || idx + 1,
          };
        }),
      );

      res.json({ photos: photosWithUrls });
    } catch (e) {
      console.error("[SLIDESHOW_ALL_PHOTOS]", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// GET /api/slideshow/results-data
router.get("/results-data", requireAuth, requireDiapo, async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from("results")
      .select("is_published")
      .limit(1)
      .maybeSingle();

    if (!settings?.is_published) {
      return res.json({ published: false });
    }

    // Récupérer les résultats
    const { data: results } = await supabase
      .from("results")
      .select(
        `
        id, rank, average_score, total_score, category_id,
        categories!results_category_id_fkey (id, name),
        submissions!results_submission_id_fkey (
          id, anonymous_id,
          photos!submissions_photo_id_fkey (storage_path)
        )
      `,
      )
      .order("category_id")
      .order("rank");

    // Classement général simplifié
    const userScores = {};
    (results || []).forEach((r) => {
      const key = r.submissions?.anonymous_id || r.submission_id;
      if (!userScores[key]) {
        userScores[key] = { anonymousId: key, total: 0 };
      }
      userScores[key].total += r.average_score || 0;
    });

    const generalRanking = Object.values(userScores)
      .sort((a, b) => b.total - a.total)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    // Prix par catégorie
    const categoryWinners = [];
    const seenCategories = new Set();
    for (const r of results || []) {
      if (r.rank === 1 && !seenCategories.has(r.category_id)) {
        seenCategories.add(r.category_id);
        let url = null;
        if (r.submissions?.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(r.submissions.photos.storage_path, 3600);
            url = signed?.signedUrl;
          } catch (err) {}
        }
        categoryWinners.push({
          categoryId: r.category_id,
          categoryName: r.categories?.name,
          anonymousId: r.submissions?.anonymous_id,
          averageScore: r.average_score,
          url,
        });
      }
    }

    // Prix de l'œil
    const { data: eyePrize } = await supabase
      .from("eye_prize_selections")
      .select(
        `
        submission_id,
        submissions!eye_prize_selections_submission_id_fkey (
          id, anonymous_id,
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `,
      )
      .maybeSingle();

    let eyePrizeWithUrl = null;
    if (eyePrize?.submissions?.photos?.storage_path) {
      try {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(eyePrize.submissions.photos.storage_path, 3600);
        eyePrizeWithUrl = {
          anonymousId: eyePrize.submissions.anonymous_id,
          categoryName: eyePrize.submissions.categories?.name,
          url: signed?.signedUrl,
        };
      } catch (err) {}
    }

    res.json({
      published: true,
      categoryWinners,
      generalRanking,
      eyePrize: eyePrizeWithUrl,
    });
  } catch (e) {
    console.error("[SLIDESHOW_RESULTS]", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
