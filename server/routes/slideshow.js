// backend/routes/slideshow.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

// ════════════════════════════════════════════════════════════════
// MODE DIAPORAMA - ÉCRAN DE PROJECTION
// ════════════════════════════════════════════════════════════════

// GET /api/slideshow/current
// Retourne la photo actuellement en notation (pour l'écran public)
router.get("/current", requireAuth, async (req, res) => {
  const { data: openSession } = await supabase
    .from("deliberation_sessions")
    .select(
      `
      category_id,
      categories(id, name),
      current_photo_id,
      current_photo:submissions!current_photo_id(
        id,
        anonymous_id,
        display_order,
        photos(storage_path)
      )
    `,
    )
    .eq("status", "open")
    .single();

  if (!openSession?.current_photo?.photos?.storage_path) {
    return res.json({ hasPhoto: false, photo: null, category: null });
  }

  // Générer URL signée
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
    photo: {
      id: openSession.current_photo.id,
      url: url,
    },
    category: openSession.categories?.name || null,
  });
});

// GET /api/slideshow/all-photos/:categoryId
// Retourne toutes les photos notées (sans identifiants)
router.get(
  "/all-photos/:categoryId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { categoryId } = req.params;

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
  },
);

// GET /api/slideshow/results-data
// Récupère toutes les données nécessaires pour l'affichage des résultats
router.get("/results-data", requireAuth, requireAdmin, async (req, res) => {
  try {
    // 1. Récupérer les résultats calculés
    const { data: results } = await supabase
      .from("results")
      .select(
        `
        id, rank, average_score, total_score, category_id,
        categories!results_category_id_fkey (id, name),
        submissions!results_submission_id_fkey (
          id, anonymous_id, display_order,
          photos!submissions_photo_id_fkey (storage_path)
        )
      `,
      )
      .order("category_id")
      .order("rank");

    // 2. Récupérer les coups de cœur
    const { data: favorites } = await supabase.from("favorites").select(`
        submission_id, category_id, created_at,
        submissions!favorites_submission_id_fkey (
          id, anonymous_id,
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `);

    // Compter les coups de cœur par soumission
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

    const favoriteList = Object.values(favoriteCounts).sort(
      (a, b) => b.count - a.count,
    );

    // Générer les URLs pour les coups de cœur
    const favoritesWithUrls = await Promise.all(
      favoriteList.map(async (fav) => {
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

    // 3. Classement général des photographes
    const userScores = {};
    (results || []).forEach((r) => {
      const key = r.submissions?.anonymous_id || r.submission_id;
      if (!userScores[key]) {
        userScores[key] = {
          anonymousId: key,
          total: 0,
          rankPosition: null,
        };
      }
      userScores[key].total += r.average_score || 0;
    });

    const generalRanking = Object.values(userScores)
      .sort((a, b) => b.total - a.total)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    // 4. Prix par catégorie (1er de chaque catégorie)
    const byCategory = {};
    (results || []).forEach((r) => {
      if (r.rank === 1 && !byCategory[r.category_id]) {
        byCategory[r.category_id] = {
          categoryId: r.category_id,
          categoryName: r.categories?.name,
          submissionId: r.submission_id,
          anonymousId: r.submissions?.anonymous_id,
          averageScore: r.average_score,
          storagePath: r.submissions?.photos?.storage_path,
        };
      }
    });

    const categoryWinners = await Promise.all(
      Object.values(byCategory).map(async (winner) => {
        let url = null;
        if (winner.storagePath) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(winner.storagePath, 3600);
            url = signed?.signedUrl;
          } catch (err) {}
        }
        return { ...winner, url };
      }),
    );

    // 5. Prix de l'œil
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
        submissionId: eyePrize.submission_id,
        anonymousId: eyePrize.submissions.anonymous_id,
        categoryName: eyePrize.submissions.categories?.name,
        url: signed?.signedUrl,
      };
    }

    res.json({
      favorites: favoritesWithUrls,
      categoryWinners: categoryWinners,
      generalRanking: generalRanking,
      eyePrize: eyePrizeWithUrl,
    });
  } catch (e) {
    console.error("[SLIDESHOW_RESULTS]", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
