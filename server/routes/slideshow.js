// backend/routes/slideshow.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireDiapo } from "../middleware/auth.js";

const router = express.Router();

// Toutes les routes slideshow sont protégées par le rôle diapo
router.use(requireAuth, requireDiapo);

// GET /api/slideshow/current - Photo en cours de notation
router.get("/current", async (req, res) => {
  try {
    const { data: openSession } = await supabase
      .from("deliberation_sessions")
      .select(
        `
        category_id,
        categories(id, name),
        current_photo_id,
        current_photo:submissions!current_photo_id(
          id,
          photos(storage_path)
        )
      `,
      )
      .eq("status", "open")
      .single();

    if (!openSession?.current_photo?.photos?.storage_path) {
      return res.json({ hasPhoto: false, photo: null, category: null });
    }

    let url = null;
    try {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(openSession.current_photo.photos.storage_path, 3600);
      url = signed?.signedUrl;
    } catch (err) {
      console.error("Erreur URL signée:", err);
    }

    res.json({
      hasPhoto: true,
      photo: { id: openSession.current_photo.id, url },
      category: openSession.categories?.name || null,
    });
  } catch (e) {
    console.error("[SLIDESHOW_CURRENT]", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slideshow/all-photos/:categoryId - Toutes les photos notées
router.get("/all-photos/:categoryId", async (req, res) => {
  const { categoryId } = req.params;

  try {
    const { data: submissions } = await supabase
      .from("submissions")
      .select(
        `
        id,
        display_order,
        photos(storage_path)
      `,
      )
      .eq("category_id", categoryId)
      .order("display_order");

    if (!submissions?.length) {
      return res.json({ photos: [] });
    }

    const photosWithUrls = await Promise.all(
      submissions.map(async (sub, idx) => {
        let url = null;
        if (sub.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(sub.photos.storage_path, 3600);
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
});

// GET /api/slideshow/results-data - Données des résultats
router.get("/results-data", async (req, res) => {
  try {
    // Vérifier si les résultats sont publiés
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

    // Récupérer les coups de cœur
    const { data: favorites } = await supabase.from("favorites").select(`
        submission_id,
        submissions!favorites_submission_id_fkey (
          id, anonymous_id,
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `);

    const favoriteCounts = {};
    (favorites || []).forEach((fav) => {
      const key = fav.submission_id;
      if (!favoriteCounts[key]) {
        favoriteCounts[key] = {
          count: 0,
          submissionId: fav.submission_id,
          anonymousId: fav.submissions?.anonymous_id,
          categoryName: fav.submissions?.categories?.name,
          storagePath: fav.submissions?.photos?.storage_path,
        };
      }
      favoriteCounts[key].count++;
    });

    const favoritesWithUrls = await Promise.all(
      Object.values(favoriteCounts)
        .sort((a, b) => b.count - a.count)
        .map(async (fav) => {
          let url = null;
          if (fav.storagePath) {
            try {
              const { data: signed } = await supabase.storage
                .from("photos")
                .createSignedUrl(fav.storagePath, 3600);
              url = signed?.signedUrl;
            } catch (err) {}
          }
          return { ...fav, url };
        }),
    );

    // Classement général
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

    // Prix par catégorie (vainqueurs)
    const categoryWinners = [];
    const seenCategories = new Set();
    (results || []).forEach((r) => {
      if (r.rank === 1 && !seenCategories.has(r.category_id)) {
        seenCategories.add(r.category_id);
        let url = null;
        if (r.submissions?.photos?.storage_path) {
          supabase.storage
            .from("photos")
            .createSignedUrl(r.submissions.photos.storage_path, 3600)
            .then(({ data }) => {
              url = data?.signedUrl;
            })
            .catch(() => {});
        }
        categoryWinners.push({
          categoryId: r.category_id,
          categoryName: r.categories?.name,
          anonymousId: r.submissions?.anonymous_id,
          averageScore: r.average_score,
        });
      }
    });

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
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(eyePrize.submissions.photos.storage_path, 3600);
      eyePrizeWithUrl = {
        anonymousId: eyePrize.submissions.anonymous_id,
        categoryName: eyePrize.submissions.categories?.name,
        url: signed?.signedUrl,
      };
    }

    res.json({
      published: true,
      favorites: favoritesWithUrls,
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
