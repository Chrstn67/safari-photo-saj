// server/routes/slideshow.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireDiapo } from "../middleware/auth.js";

const router = express.Router();

// GET /api/slideshow/status
router.get("/status", requireAuth, requireDiapo, async (req, res) => {
  console.log("[SLIDESHOW_STATUS] Called");

  try {
    // Récupérer la session ouverte avec sa photo courante
    const { data: openSession, error: openError } = await supabase
      .from("deliberation_sessions")
      .select(
        `
        id, 
        category_id, 
        status, 
        current_photo_id,
        categories:category_id (name)
      `,
      )
      .eq("status", "open")
      .maybeSingle();

    if (openError) {
      console.error("[SLIDESHOW_STATUS] openSession error:", openError);
    }

    // Vérifier si une session est complétée
    const { data: completedSession, error: completedError } = await supabase
      .from("deliberation_sessions")
      .select("id, category_id, status")
      .eq("status", "completed")
      .maybeSingle();

    if (completedError) {
      console.error(
        "[SLIDESHOW_STATUS] completedSession error:",
        completedError,
      );
    }

    // Vérifier les résultats publiés
    const { data: resultsStatus, error: resultsError } = await supabase
      .from("results")
      .select("is_published")
      .limit(1)
      .maybeSingle();

    if (resultsError) {
      console.error("[SLIDESHOW_STATUS] resultsStatus error:", resultsError);
    }

    const hasOpenSession = !!openSession;
    const hasCurrentPhoto = hasOpenSession && !!openSession.current_photo_id;

    console.log(
      "[SLIDESHOW_STATUS] hasOpenSession:",
      hasOpenSession,
      "hasCurrentPhoto:",
      hasCurrentPhoto,
    );

    res.json({
      hasOpenSession: hasOpenSession,
      hasCurrentPhoto: hasCurrentPhoto,
      openSession: openSession
        ? {
            id: openSession.id,
            categoryId: openSession.category_id,
            categoryName: openSession.categories?.name,
            hasCurrentPhoto: hasCurrentPhoto,
            currentPhotoId: openSession.current_photo_id,
          }
        : null,
      hasCompletedSession: !!completedSession,
      resultsPublished: resultsStatus?.is_published || false,
    });
  } catch (e) {
    console.error("[SLIDESHOW_STATUS] Exception:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slideshow/current
router.get("/current", requireAuth, requireDiapo, async (req, res) => {
  console.log("[SLIDESHOW_CURRENT] Called");

  try {
    // Récupérer la session ouverte avec sa photo
    const { data: openSession, error: sessionError } = await supabase
      .from("deliberation_sessions")
      .select(
        `
        id,
        category_id,
        status,
        current_photo_id,
        categories:category_id (name),
        current_photo:current_photo_id (
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

    if (sessionError) {
      console.error("[SLIDESHOW_CURRENT] session error:", sessionError);
      return res.status(500).json({ error: sessionError.message });
    }

    if (
      !openSession ||
      !openSession.current_photo_id ||
      !openSession.current_photo
    ) {
      console.log("[SLIDESHOW_CURRENT] No active session or photo");
      return res.json({ hasPhoto: false, photo: null, category: null });
    }

    const storagePath = openSession.current_photo.photos?.storage_path;
    if (!storagePath) {
      console.log("[SLIDESHOW_CURRENT] No storage path");
      return res.json({ hasPhoto: false, photo: null, category: null });
    }

    // Générer URL signée
    let url = null;
    try {
      const { data: signed, error: signedError } = await supabase.storage
        .from("photos")
        .createSignedUrl(storagePath, 3600);

      if (signedError) {
        console.error("[SLIDESHOW_CURRENT] Signed URL error:", signedError);
      } else {
        url = signed?.signedUrl;
      }
    } catch (err) {
      console.error("[SLIDESHOW_CURRENT] URL exception:", err);
    }

    console.log(
      "[SLIDESHOW_CURRENT] Photo found:",
      openSession.current_photo.anonymous_id,
    );

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
    console.error("[SLIDESHOW_CURRENT] Exception:", e);
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
      console.log("[SLIDESHOW_ALL_PHOTOS] categoryId:", categoryId);

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

      if (error) {
        console.error("[SLIDESHOW_ALL_PHOTOS] error:", error);
        return res.status(500).json({ error: error.message });
      }

      if (!submissions?.length) {
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
            } catch (err) {
              console.error("[SLIDESHOW_ALL_PHOTOS] URL error:", err);
            }
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
      console.error("[SLIDESHOW_ALL_PHOTOS] Exception:", e);
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
    console.error("[SLIDESHOW_RESULTS_DATA]", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
