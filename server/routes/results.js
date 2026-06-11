// backend/routes/results.js (version corrigée)

import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

/* ── Calcul des scores moyens ── */
async function computeAverages(categoryId) {
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, anonymous_id, display_order, user_id, scores(value, juror_id)")
    .eq("category_id", categoryId);

  return (subs || [])
    .map((sub) => {
      const byJuror = {};
      (sub.scores || []).forEach((s) => {
        if (!byJuror[s.juror_id]) byJuror[s.juror_id] = 0;
        byJuror[s.juror_id] += s.value;
      });
      const jurorTotals = Object.values(byJuror);
      const avg = jurorTotals.length
        ? jurorTotals.reduce((a, b) => a + b, 0) / jurorTotals.length
        : 0;
      const total = jurorTotals.reduce((a, b) => a + b, 0);
      return {
        submissionId: sub.id,
        anonymousId: sub.anonymous_id,
        displayOrder: sub.display_order,
        userId: sub.user_id,
        average: Math.round(avg * 100) / 100,
        totalScore: total,
        jurorCount: jurorTotals.length,
      };
    })
    .sort((a, b) => b.average - a.average);
}

/* ── GET /api/results/status  — état de publication ── */
router.get("/status", requireAuth, async (req, res) => {
  const { data } = await supabase
    .from("results")
    .select("is_published, jurors_can_view")
    .limit(1)
    .maybeSingle();

  res.json({
    isPublished: data?.is_published === true,
    jurorsCanView: data?.jurors_can_view === true,
    hasResults: data !== null,
  });
});

/* ── GET /api/results  — résultats selon les droits ── */
router.get("/", requireAuth, async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const isJuror = req.user.role === "juror";
  const isParticipant = req.user.role === "participant";

  const { data: settings } = await supabase
    .from("results")
    .select("is_published, jurors_can_view")
    .limit(1)
    .maybeSingle();

  const jurorsCanView = settings?.jurors_can_view === true;
  const isPublished = settings?.is_published === true;

  let canView = false;
  if (isAdmin) canView = true;
  else if (isJuror) canView = jurorsCanView;
  else if (isParticipant) canView = isPublished;

  if (!canView) {
    return res.status(403).json({ error: "Résultats non disponibles" });
  }

  const { data: results, error } = await supabase
    .from("results")
    .select(
      `
      *,
      categories(id, name),
      submissions!submission_id(
        id, anonymous_id, display_order,
        photos(storage_path),
        users(first_name, last_name)
      )
    `,
    )
    .order("category_id")
    .order("rank");

  if (error) return res.status(500).json({ error: error.message });

  const sanitized = (results || []).map((r) => ({
    ...r,
    author:
      (isPublished || isAdmin || isJuror) && r.submissions?.users
        ? `${r.submissions.users.first_name} ${r.submissions.users.last_name}`
        : null,
  }));

  res.json(sanitized);
});

/* ── POST /api/results/compute  — calculer et stocker les résultats ── */
router.post("/compute", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: cats, error: catError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true);

    if (catError) {
      console.error("[compute] Erreur fetch catégories:", catError);
      return res.status(500).json({ error: catError.message });
    }

    if (!cats || cats.length === 0) {
      return res.status(400).json({ error: "Aucune catégorie active" });
    }

    const { data: scoreCheck } = await supabase
      .from("scores")
      .select("id")
      .limit(1);

    if (!scoreCheck || scoreCheck.length === 0) {
      return res.status(400).json({
        error: "Aucune note saisie — impossible de calculer les résultats",
      });
    }

    const { error: deleteError } = await supabase
      .from("results")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.error("[compute] Erreur suppression:", deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    const allResults = [];

    for (const cat of cats) {
      const ranked = await computeAverages(cat.id);

      if (ranked.length === 0) {
        console.warn(
          `[compute] Catégorie "${cat.name}" sans soumissions notées, ignorée`,
        );
        continue;
      }

      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];
        const { data: inserted, error: insertError } = await supabase
          .from("results")
          .insert({
            category_id: cat.id,
            submission_id: r.submissionId,
            rank: i + 1,
            average_score: r.average,
            total_score: r.totalScore,
            is_published: false,
            jurors_can_view: false,
            computed_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          console.error("[compute] Erreur insertion résultat:", insertError);
          return res.status(500).json({ error: insertError.message });
        }

        allResults.push(inserted);
      }
    }

    if (allResults.length === 0) {
      return res.status(400).json({
        error:
          "Aucun résultat calculé — vérifiez que des notes ont été saisies",
      });
    }

    await log(req.user.id, "RESULTS_COMPUTE", "results", null);
    res.json({ computed: allResults.length, results: allResults });
  } catch (e) {
    console.error("[compute] Exception:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/results/publish-to-jurors  — publier aux jurés seulement ── */
router.post(
  "/publish-to-jurors",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: check } = await supabase
        .from("results")
        .select("id")
        .limit(1);

      if (!check || check.length === 0) {
        return res.status(400).json({
          error:
            "Aucun résultat calculé. Cliquez d'abord sur 'Calculer les résultats'.",
        });
      }

      const { error } = await supabase
        .from("results")
        .update({ jurors_can_view: true })
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) throw error;

      await log(req.user.id, "RESULTS_PUBLISH_TO_JURORS", "results", null);
      res.json({
        success: true,
        message: "Résultats disponibles pour les jurés",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

/* ── POST /api/results/publish-to-participants  — publier aux participants ── */
router.post(
  "/publish-to-participants",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: check } = await supabase
        .from("results")
        .select("id")
        .limit(1);

      if (!check || check.length === 0) {
        return res.status(400).json({
          error:
            "Aucun résultat calculé. Cliquez d'abord sur 'Calculer les résultats'.",
        });
      }

      const { error } = await supabase
        .from("results")
        .update({
          is_published: true,
          published_at: new Date().toISOString(),
          published_by: req.user.id,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) throw error;

      await log(
        req.user.id,
        "RESULTS_PUBLISH_TO_PARTICIPANTS",
        "results",
        null,
      );
      res.json({
        success: true,
        message: "Résultats disponibles pour les participants",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

/* ── POST /api/results/unpublish  — masquer tous les résultats ── */
router.post("/unpublish", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("results")
      .update({ is_published: false, jurors_can_view: false })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) throw error;

    await log(req.user.id, "RESULTS_UNPUBLISH_ALL", "results", null);
    res.json({ success: true, message: "Tous les résultats sont masqués" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/results/palmares  — palmarès complet avec toutes les récompenses ── */
router.get("/palmares", requireAuth, async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const isJuror = req.user.role === "juror";
  const isParticipant = req.user.role === "participant";

  const { data: settings } = await supabase
    .from("results")
    .select("is_published, jurors_can_view")
    .limit(1)
    .maybeSingle();

  const jurorsCanView = settings?.jurors_can_view === true;
  const isPublished = settings?.is_published === true;

  let canView = false;
  if (isAdmin) canView = true;
  else if (isJuror) canView = jurorsCanView;
  else if (isParticipant) canView = isPublished;

  if (!canView) {
    return res.status(403).json({ error: "Palmarès non disponible" });
  }

  // 1. Récupérer les résultats par catégorie
  const { data: results } = await supabase
    .from("results")
    .select(
      `
      rank, average_score, total_score, category_id,
      categories(name),
      submissions!submission_id(
        id, anonymous_id,
        photos(storage_path),
        users!user_id(first_name, last_name)
      )
    `,
    )
    .order("category_id")
    .order("rank");

  // 2. Récupérer les coups de cœur du jury avec les infos complètes
  const { data: favorites } = await supabase.from("favorites").select(`
      id,
      submission_id,
      category_id,
      submissions!submission_id(
        id,
        anonymous_id,
        display_order,
        users!user_id(
          first_name,
          last_name
        ),
        categories!category_id(
          name
        )
      )
    `);

  console.log("[DEBUG] Favorites récupérés:", favorites?.length || 0);

  // Compter les coups de cœur par photo
  const favoriteCounts = {};
  (favorites || []).forEach((fav) => {
    const submission = fav.submissions;
    if (!submission) {
      console.log("[DEBUG] Submission non trouvée pour fav:", fav.id);
      return;
    }

    const key = fav.submission_id;
    if (!favoriteCounts[key]) {
      favoriteCounts[key] = {
        count: 0,
        submissionId: fav.submission_id,
        anonymousId: submission.anonymous_id,
        categoryName: submission.categories?.name,
        author: submission.users
          ? `${submission.users.first_name} ${submission.users.last_name}`
          : null,
        categoryId: fav.category_id,
      };
    }
    favoriteCounts[key].count++;
  });

  console.log("[DEBUG] Favorite counts:", favoriteCounts);

  // Photo avec le plus de coups de cœur
  let topFavorite = null;
  let maxFavs = 0;
  Object.values(favoriteCounts).forEach((fav) => {
    if (fav.count > maxFavs) {
      maxFavs = fav.count;
      topFavorite = fav;
    }
  });

  console.log("[DEBUG] Top favorite:", topFavorite, "maxFavs:", maxFavs);

  // 3. Calculer le classement général des participants
  const userScores = {};
  (results || []).forEach((r) => {
    const u = r.submissions?.users;
    if (!u) return;
    const key = `${u.first_name} ${u.last_name}`;
    if (!userScores[key]) {
      userScores[key] = {
        name: key,
        total: 0,
        finalists: 0,
        userId: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
      };
    }
    userScores[key].total += r.average_score || 0;
    if (r.rank === 1) userScores[key].finalists++;
  });

  const generalRanking = Object.values(userScores).sort(
    (a, b) => b.total - a.total,
  );

  // Meilleur photographe = 1er du classement général
  const bestPhotographer = generalRanking[0] || null;

  // 4. Pour le Prix de l'œil, récupérer toutes les photos soumises
  const { data: allSubmissions } = await supabase
    .from("submissions")
    .select(
      `
      id,
      anonymous_id,
      display_order,
      category_id,
      categories(name),
      photos(storage_path),
      users(first_name, last_name)
    `,
    )
    .order("created_at");

  // Ajouter les URLs signées pour les photos du Prix de l'œil
  const submissionsWithUrls = await Promise.all(
    (allSubmissions || []).map(async (sub) => {
      let photoUrl = null;
      if (sub.photos?.storage_path) {
        try {
          const { data: signed } = await supabase.storage
            .from("photos")
            .createSignedUrl(sub.photos.storage_path, 3600);
          photoUrl = signed?.signedUrl;
        } catch (err) {
          console.error("Erreur URL signée:", err.message);
        }
      }
      return {
        ...sub,
        photoUrl,
      };
    }),
  );

  // 5. Récupérer les prix de l'œil existants
  const { data: eyePrize } = await supabase
    .from("eye_prize_selections")
    .select(
      `
      *,
      submissions!submission_id(
        id,
        anonymous_id,
        users(first_name, last_name),
        categories(name),
        photos(storage_path)
      )
    `,
    )
    .maybeSingle();

  // Ajouter l'URL signée pour le prix de l'œil
  let eyePrizeWithUrl = null;
  if (eyePrize?.submissions?.photos?.storage_path) {
    try {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(eyePrize.submissions.photos.storage_path, 3600);
      eyePrizeWithUrl = {
        ...eyePrize,
        submissions: {
          ...eyePrize.submissions,
          photoUrl: signed?.signedUrl,
        },
      };
    } catch (err) {
      eyePrizeWithUrl = eyePrize;
    }
  } else {
    eyePrizeWithUrl = eyePrize;
  }

  res.json({
    byCategory: results || [],
    favorites: favorites || [],
    generalRanking: generalRanking,
    topFavorite: topFavorite
      ? {
          ...topFavorite,
          totalFavorites: maxFavs,
        }
      : null,
    bestPhotographer: bestPhotographer,
    allSubmissions: submissionsWithUrls || [],
    eyePrize: eyePrizeWithUrl,
    jurorsCanView,
    isPublished,
    canSelectEyePrize: isJuror || isAdmin,
  });
});

/* ── POST /api/results/select-eye-prize  — sélectionner la photo pour le Prix de l'œil ── */
router.post("/select-eye-prize", requireAuth, async (req, res) => {
  const { submissionId } = req.body;

  if (!submissionId) {
    return res.status(400).json({ error: "submissionId requis" });
  }

  // Vérifier que l'utilisateur est juré ou admin
  if (req.user.role !== "juror" && req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Seuls les jurés peuvent sélectionner" });
  }

  try {
    // Vérifier que la soumission existe
    const { data: submission, error: subError } = await supabase
      .from("submissions")
      .select(
        "id, anonymous_id, users(first_name, last_name), categories(name)",
      )
      .eq("id", submissionId)
      .single();

    if (subError || !submission) {
      return res.status(404).json({ error: "Photo introuvable" });
    }

    // Supprimer l'ancienne sélection s'il y en a une
    await supabase
      .from("eye_prize_selections")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    // Enregistrer la nouvelle sélection
    const { error } = await supabase.from("eye_prize_selections").insert({
      submission_id: submissionId,
      selected_by: req.user.id,
      selected_at: new Date().toISOString(),
    });

    if (error) throw error;

    await log(req.user.id, "EYE_PRIZE_SELECT", "submissions", submissionId, {
      anonymousId: submission.anonymous_id,
    });

    res.json({
      success: true,
      message: "Prix de l'œil attribué",
      selected: {
        id: submission.id,
        anonymousId: submission.anonymous_id,
        author: submission.users
          ? `${submission.users.first_name} ${submission.users.last_name}`
          : null,
        category: submission.categories?.name,
      },
    });
  } catch (e) {
    console.error("[EYE_PRIZE] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
