// backend/routes/results.js - Version corrigée
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

// ════════════════════════════════════════════════════════════════
// FONCTION DE CALCUL DES MOYENNES (corrigée)
// ════════════════════════════════════════════════════════════════
async function computeAverages(categoryId) {
  console.log(`[computeAverages] Catégorie ${categoryId}`);

  // Récupérer toutes les soumissions de la catégorie
  const { data: submissions, error: subError } = await supabase
    .from("submissions")
    .select(
      `
      id, 
      anonymous_id, 
      display_order, 
      user_id
    `,
    )
    .eq("category_id", categoryId);

  if (subError) {
    console.error("[computeAverages] Erreur:", subError);
    return [];
  }

  if (!submissions || submissions.length === 0) {
    console.log(
      `[computeAverages] Aucune soumission pour catégorie ${categoryId}`,
    );
    return [];
  }

  console.log(`[computeAverages] ${submissions.length} soumissions trouvées`);

  const results = [];

  for (const sub of submissions) {
    // Récupérer les scores pour cette soumission
    const { data: scores, error: scoreError } = await supabase
      .from("scores")
      .select("value, juror_id")
      .eq("submission_id", sub.id);

    if (scoreError) {
      console.error(
        `[computeAverages] Erreur scores pour ${sub.id}:`,
        scoreError,
      );
      continue;
    }

    if (!scores || scores.length === 0) {
      console.log(
        `[computeAverages] Aucun score pour soumission ${sub.anonymous_id}`,
      );
      continue;
    }

    // Grouper les scores par juré
    const byJuror = {};
    scores.forEach((s) => {
      if (!byJuror[s.juror_id]) {
        byJuror[s.juror_id] = 0;
      }
      byJuror[s.juror_id] += s.value;
    });

    const jurorTotals = Object.values(byJuror);
    const avg = jurorTotals.length
      ? jurorTotals.reduce((a, b) => a + b, 0) / jurorTotals.length
      : 0;
    const total = jurorTotals.reduce((a, b) => a + b, 0);

    results.push({
      submissionId: sub.id,
      anonymousId: sub.anonymous_id,
      displayOrder: sub.display_order,
      userId: sub.user_id,
      average: Math.round(avg * 100) / 100,
      totalScore: total,
      jurorCount: jurorTotals.length,
    });
  }

  // Trier par moyenne décroissante
  const sorted = results.sort((a, b) => b.average - a.average);
  console.log(`[computeAverages] ${sorted.length} résultats calculés`);
  return sorted;
}

// ════════════════════════════════════════════════════════════════
// GET /api/results/status
// ════════════════════════════════════════════════════════════════
router.get("/status", requireAuth, async (req, res) => {
  try {
    const { data } = await supabase
      .from("results")
      .select("is_published, jurors_can_view")
      .limit(1)
      .maybeSingle();

    // Vérifier s'il y a des résultats calculés
    const { count } = await supabase
      .from("results")
      .select("*", { count: "exact", head: true });

    res.json({
      isPublished: data?.is_published === true,
      jurorsCanView: data?.jurors_can_view === true,
      hasResults: (count || 0) > 0,
    });
  } catch (e) {
    console.error("[status] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/results/compute — CALCUL DES RÉSULTATS (corrigé)
// ════════════════════════════════════════════════════════════════
router.post("/compute", requireAuth, requireAdmin, async (req, res) => {
  console.log("[COMPUTE] Début du calcul des résultats");

  try {
    // 1. Récupérer toutes les catégories actives
    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true);

    if (catError) {
      console.error("[COMPUTE] Erreur fetch catégories:", catError);
      return res.status(500).json({ error: catError.message });
    }

    if (!categories || categories.length === 0) {
      return res.status(400).json({ error: "Aucune catégorie active" });
    }

    console.log(`[COMPUTE] ${categories.length} catégories trouvées`);

    // 2. Supprimer les anciens résultats
    const { error: deleteError } = await supabase
      .from("results")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.error("[COMPUTE] Erreur suppression:", deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    console.log("[COMPUTE] Anciens résultats supprimés");

    const allResults = [];
    let categoriesWithResults = 0;

    // 3. Pour chaque catégorie, calculer les moyennes
    for (const cat of categories) {
      console.log(`[COMPUTE] Traitement: ${cat.name}`);

      const ranked = await computeAverages(cat.id);

      if (ranked.length === 0) {
        console.warn(`[COMPUTE] Catégorie "${cat.name}" sans données, ignorée`);
        continue;
      }

      categoriesWithResults++;
      console.log(`[COMPUTE] ${ranked.length} résultats pour ${cat.name}`);

      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];

        // Vérifier si le résultat existe déjà
        const { data: existing } = await supabase
          .from("results")
          .select("id")
          .eq("category_id", cat.id)
          .eq("submission_id", r.submissionId)
          .maybeSingle();

        let inserted;
        if (existing) {
          const { data: updated, error: updateError } = await supabase
            .from("results")
            .update({
              rank: i + 1,
              average_score: r.average,
              total_score: r.totalScore,
              computed_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
            .select()
            .single();

          if (updateError) throw updateError;
          inserted = updated;
        } else {
          const { data: newResult, error: insertError } = await supabase
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

          if (insertError) throw insertError;
          inserted = newResult;
        }

        allResults.push(inserted);
      }
    }

    if (allResults.length === 0) {
      return res.status(400).json({
        error:
          "Aucun résultat calculé — vérifiez que des notes ont été saisies dans au moins une catégorie",
      });
    }

    console.log(
      `[COMPUTE] SUCCÈS: ${allResults.length} résultats, ${categoriesWithResults} catégories`,
    );

    await log(req.user.id, "RESULTS_COMPUTE", "results", null, {
      count: allResults.length,
      categories: categoriesWithResults,
    });

    res.json({
      computed: allResults.length,
      categories: categoriesWithResults,
      results: allResults,
    });
  } catch (e) {
    console.error("[COMPUTE] Exception:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/results/publish-to-jurors
// ════════════════════════════════════════════════════════════════
router.post(
  "/publish-to-jurors",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { count } = await supabase
        .from("results")
        .select("*", { count: "exact", head: true });

      if ((count || 0) === 0) {
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
      console.error("[publish-to-jurors] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// POST /api/results/publish-to-participants
// ════════════════════════════════════════════════════════════════
router.post(
  "/publish-to-participants",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { count } = await supabase
        .from("results")
        .select("*", { count: "exact", head: true });

      if ((count || 0) === 0) {
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
      console.error("[publish-to-participants] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// POST /api/results/unpublish
// ════════════════════════════════════════════════════════════════
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
    console.error("[unpublish] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/results/palmares
// ════════════════════════════════════════════════════════════════
router.get("/palmares", requireAuth, async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const isJuror = req.user.role === "juror";
  const isParticipant = req.user.role === "participant";

  try {
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

    // Récupérer les résultats avec JOIN corrects
    const { data: results, error: resultsError } = await supabase
      .from("results")
      .select(
        `
        id,
        rank,
        average_score,
        total_score,
        category_id,
        categories!results_category_id_fkey (
          id,
          name
        ),
        submissions!results_submission_id_fkey (
          id,
          anonymous_id,
          display_order,
          photo_id,
          photos!submissions_photo_id_fkey (
            storage_path
          ),
          users!submissions_user_id_fkey (
            first_name,
            last_name
          )
        )
      `,
      )
      .order("category_id")
      .order("rank");

    if (resultsError) {
      console.error("[palmares] Erreur:", resultsError);
      return res.status(500).json({ error: resultsError.message });
    }

    // Ajouter les URLs signées
    const resultsWithUrls = await Promise.all(
      (results || []).map(async (r) => {
        let photoUrl = null;
        const storagePath = r.submissions?.photos?.storage_path;
        if (storagePath) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(storagePath, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {
            console.error("Erreur URL:", err.message);
          }
        }

        const author = r.submissions?.users
          ? `${r.submissions.users.first_name} ${r.submissions.users.last_name}`
          : null;

        return {
          ...r,
          author,
          submissions: {
            ...r.submissions,
            photoUrl,
          },
        };
      }),
    );

    // Classement général par photographe
    const userScores = {};
    (resultsWithUrls || []).forEach((r) => {
      const author = r.author;
      if (!author) return;

      if (!userScores[author]) {
        userScores[author] = {
          name: author,
          total: 0,
          finalists: 0,
        };
      }
      userScores[author].total += r.average_score || 0;
      if (r.rank === 1) userScores[author].finalists++;
    });

    const generalRanking = Object.values(userScores).sort(
      (a, b) => b.total - a.total,
    );
    const bestPhotographer = generalRanking[0] || null;

    // Récupérer les coups de cœur
    const { data: favorites, error: favError } = await supabase.from(
      "favorites",
    ).select(`
        id,
        submission_id,
        category_id,
        submissions!favorites_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path
          )
        )
      `);

    if (favError) {
      console.error("[palmares] Erreur favorites:", favError);
    }

    const favoritesWithUrls = await Promise.all(
      (favorites || []).map(async (fav) => {
        let photoUrl = null;
        const storagePath = fav.submissions?.photos?.storage_path;
        if (storagePath) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(storagePath, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {}
        }

        return {
          ...fav,
          submissions: {
            ...fav.submissions,
            photoUrl,
          },
        };
      }),
    );

    // Compter les coups de cœur
    const favoriteCounts = {};
    favoritesWithUrls.forEach((fav) => {
      const key = fav.submission_id;
      if (!favoriteCounts[key]) {
        favoriteCounts[key] = {
          count: 0,
          submissionId: fav.submission_id,
          anonymousId: fav.submissions?.anonymous_id,
          author: fav.submissions?.users
            ? `${fav.submissions.users.first_name} ${fav.submissions.users.last_name}`
            : null,
          categoryName: fav.submissions?.categories?.name,
          photoUrl: fav.submissions?.photoUrl,
        };
      }
      favoriteCounts[key].count++;
    });

    let topFavorite = null;
    let maxFavs = 0;
    Object.values(favoriteCounts).forEach((fav) => {
      if (fav.count > maxFavs) {
        maxFavs = fav.count;
        topFavorite = fav;
      }
    });

    // Prix de l'œil finalisé
    const { data: eyePrizeResult } = await supabase
      .from("eye_prize_result")
      .select(
        `
        id,
        total_votes,
        is_finalized,
        finalized_at,
        submissions!eye_prize_result_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path
          )
        )
      `,
      )
      .eq("is_finalized", true)
      .maybeSingle();

    let eyePrizeWithUrl = null;
    if (eyePrizeResult?.submissions?.photos?.storage_path) {
      try {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(
            eyePrizeResult.submissions.photos.storage_path,
            3600,
          );
        eyePrizeWithUrl = {
          ...eyePrizeResult,
          submissions: {
            ...eyePrizeResult.submissions,
            photoUrl: signed?.signedUrl,
          },
        };
      } catch (err) {
        eyePrizeWithUrl = eyePrizeResult;
      }
    } else {
      eyePrizeWithUrl = eyePrizeResult;
    }

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: Object.values(favoriteCounts),
      topFavorite: topFavorite
        ? { ...topFavorite, totalFavorites: maxFavs }
        : null,
      bestPhotographer: bestPhotographer,
      generalRanking: generalRanking,
      eyePrize: eyePrizeWithUrl,
      jurorsCanView,
      isPublished,
    });
  } catch (e) {
    console.error("[palmares] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PRIX DE L'ŒIL - ROUTES
// ════════════════════════════════════════════════════════════════

router.get("/eye-prize/votes", requireAuth, requireJuror, async (req, res) => {
  try {
    const { data: votes, error: votesError } = await supabase.from(
      "eye_prize_votes",
    ).select(`
        id,
        juror_id,
        submission_id,
        voted_at,
        submissions!eye_prize_votes_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path
          )
        )
      `);

    if (votesError) throw votesError;

    const votesWithUrls = await Promise.all(
      (votes || []).map(async (vote) => {
        let photoUrl = null;
        const storagePath = vote.submissions?.photos?.storage_path;
        if (storagePath) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(storagePath, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {}
        }
        return {
          ...vote,
          submissions: {
            ...vote.submissions,
            photoUrl,
          },
        };
      }),
    );

    const voteCounts = {};
    votesWithUrls.forEach((vote) => {
      const key = vote.submission_id;
      if (!voteCounts[key]) {
        voteCounts[key] = {
          submissionId: vote.submission_id,
          anonymousId: vote.submissions?.anonymous_id,
          author: vote.submissions?.users
            ? `${vote.submissions.users.first_name} ${vote.submissions.users.last_name}`
            : null,
          photoUrl: vote.submissions?.photoUrl,
          votes: 0,
        };
      }
      voteCounts[key].votes++;
    });

    const myVote = votesWithUrls?.find((v) => v.juror_id === req.user.id);

    const { data: finalResult } = await supabase
      .from("eye_prize_result")
      .select(
        `
        *,
        submissions!eye_prize_result_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path
          )
        )
      `,
      )
      .eq("is_finalized", true)
      .maybeSingle();

    const { data: allJurors } = await supabase
      .from("users")
      .select("id")
      .in("role_id", [2, 3]);

    res.json({
      voteCounts: Object.values(voteCounts),
      myVote: myVote || null,
      finalResult,
      totalJurors: allJurors?.length || 0,
    });
  } catch (e) {
    console.error("[eye-prize/votes] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/eye-prize/vote", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId)
    return res.status(400).json({ error: "submissionId requis" });

  try {
    const { data: submission } = await supabase
      .from("submissions")
      .select("id, anonymous_id, category_id")
      .eq("id", submissionId)
      .single();

    if (!submission)
      return res.status(404).json({ error: "Photo introuvable" });

    const { data: existingVote } = await supabase
      .from("eye_prize_votes")
      .select("id")
      .eq("juror_id", req.user.id)
      .maybeSingle();

    if (existingVote) {
      await supabase
        .from("eye_prize_votes")
        .update({
          submission_id: submissionId,
          category_id: submission.category_id,
          voted_at: new Date().toISOString(),
        })
        .eq("id", existingVote.id);
    } else {
      await supabase.from("eye_prize_votes").insert({
        juror_id: req.user.id,
        submission_id: submissionId,
        category_id: submission.category_id,
        voted_at: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: "Vote enregistré !" });
  } catch (e) {
    console.error("[eye-prize/vote] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;
    if (!submissionId)
      return res.status(400).json({ error: "submissionId requis" });

    try {
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      const { data: result } = await supabase
        .from("eye_prize_result")
        .insert({
          submission_id: submissionId,
          is_finalized: true,
          finalized_at: new Date().toISOString(),
          finalized_by: req.user.id,
        })
        .select()
        .single();

      res.json({ success: true, message: "Prix de l'œil finalisé !" });
    } catch (e) {
      console.error("[eye-prize/finalize] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

router.post("/eye-prize/reset", requireAuth, requireAdmin, async (req, res) => {
  try {
    await supabase
      .from("eye_prize_votes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase
      .from("eye_prize_result")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    res.json({ success: true, message: "Votes réinitialisés" });
  } catch (e) {
    console.error("[eye-prize/reset] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
