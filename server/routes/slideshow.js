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
    console.log("[SLIDESHOW] Récupération de la photo en cours...");

    // Récupérer la session ouverte avec toutes les infos
    const { data: openSession, error: sessionError } = await supabase
      .from("deliberation_sessions")
      .select(
        `
        id,
        category_id,
        status,
        current_photo_id,
        categories!deliberation_sessions_category_id_fkey (
          id, 
          name
        ),
        current_photo:submissions!current_photo_id (
          id,
          anonymous_id,
          display_order,
          photo_id,
          photos:photo_id (
            storage_path,
            filename
          )
        )
      `,
      )
      .eq("status", "open")
      .maybeSingle();

    if (sessionError) {
      console.error("[SLIDESHOW] Erreur session:", sessionError);
      return res.json({
        hasPhoto: false,
        photo: null,
        category: null,
        error: sessionError.message,
      });
    }

    console.log("[SLIDESHOW] Session trouvée:", openSession ? "oui" : "non");

    if (!openSession) {
      return res.json({ hasPhoto: false, photo: null, category: null });
    }

    // Vérifier si current_photo existe
    if (!openSession.current_photo_id) {
      console.log("[SLIDESHOW] Pas de photo courante");
      return res.json({
        hasPhoto: false,
        photo: null,
        category: openSession.categories?.name,
      });
    }

    // Vérifier si la photo est chargée correctement
    if (!openSession.current_photo) {
      console.log("[SLIDESHOW] Rechargement de la photo manquante...");
      // Recharger la soumission avec la photo
      const { data: submission, error: subError } = await supabase
        .from("submissions")
        .select(
          `
          id,
          anonymous_id,
          display_order,
          photo_id,
          photos!submissions_photo_id_fkey (
            storage_path,
            filename
          )
        `,
        )
        .eq("id", openSession.current_photo_id)
        .single();

      if (subError || !submission) {
        console.error("[SLIDESHOW] Erreur rechargement submission:", subError);
        return res.json({
          hasPhoto: false,
          photo: null,
          category: openSession.categories?.name,
        });
      }

      openSession.current_photo = submission;
    }

    const storagePath = openSession.current_photo.photos?.storage_path;
    console.log("[SLIDESHOW] Storage path:", storagePath);

    if (!storagePath) {
      console.log("[SLIDESHOW] Pas de storage path");
      return res.json({
        hasPhoto: false,
        photo: null,
        category: openSession.categories?.name,
      });
    }

    // Générer URL signée
    let url = null;
    try {
      const { data: signed, error: signedError } = await supabase.storage
        .from("photos")
        .createSignedUrl(storagePath, 3600);

      if (signedError) {
        console.error("[SLIDESHOW] Erreur URL signée:", signedError);
      } else {
        url = signed?.signedUrl;
        console.log("[SLIDESHOW] URL générée avec succès");
      }
    } catch (err) {
      console.error("[SLIDESHOW] Exception URL signée:", err);
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
    console.error("[SLIDESHOW_CURRENT] Exception:", e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// GET /api/slideshow/all-photos/:categoryId - Toutes les photos notées
router.get("/all-photos/:categoryId", async (req, res) => {
  const { categoryId } = req.params;

  try {
    console.log(
      "[SLIDESHOW] Récupération de toutes les photos pour catégorie:",
      categoryId,
    );

    const { data: submissions, error: subError } = await supabase
      .from("submissions")
      .select(
        `
        id,
        display_order,
        photos!submissions_photo_id_fkey (
          storage_path
        )
      `,
      )
      .eq("category_id", categoryId)
      .order("display_order", { ascending: true });

    if (subError) {
      console.error("[SLIDESHOW] Erreur récupération soumissions:", subError);
      return res.json({ photos: [] });
    }

    if (!submissions?.length) {
      console.log("[SLIDESHOW] Aucune soumission trouvée");
      return res.json({ photos: [] });
    }

    console.log("[SLIDESHOW] Nombre de soumissions:", submissions.length);

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
            console.error("Erreur URL pour photo:", err);
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
    console.error("[SLIDESHOW_ALL_PHOTOS]", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/slideshow/status - Vérifier l'état de la session
router.get("/status", async (req, res) => {
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
