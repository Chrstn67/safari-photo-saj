// backend/routes/results.js - Version complète et corrigée

import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

/* ── Calcul des scores moyens pour une catégorie ── */
async function computeAverages(categoryId) {
  // Récupérer toutes les soumissions de la catégorie avec leurs scores
  const { data: submissions, error: subError } = await supabase
    .from("submissions")
    .select(
      `
      id, 
      anonymous_id, 
      display_order, 
      user_id,
      scores!scores_submission_id_fkey (
        value, 
        juror_id
      )
    `,
    )
    .eq("category_id", categoryId);

  if (subError) {
    console.error("[computeAverages] Erreur:", subError);
    return [];
  }

  if (!submissions || submissions.length === 0) {
    return [];
  }

  const results = submissions.map((sub) => {
    // Grouper les scores par juré
    const byJuror = {};
    const scores = sub.scores || [];

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

    return {
      submissionId: sub.id,
      anonymousId: sub.anonymous_id,
      displayOrder: sub.display_order,
      userId: sub.user_id,
      average: Math.round(avg * 100) / 100,
      totalScore: total,
      jurorCount: jurorTotals.length,
    };
  });

  // Trier par moyenne décroissante
  return results.sort((a, b) => b.average - a.average);
}

/* ── GET /api/results/status ── */
router.get("/status", requireAuth, async (req, res) => {
  try {
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
  } catch (e) {
    console.error("[status] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/results ── */
router.get("/", requireAuth, async (req, res) => {
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
      return res.status(403).json({ error: "Résultats non disponibles" });
    }

    const { data: results, error } = await supabase
      .from("results")
      .select(
        `
        *,
        categories(id, name),
        submissions!submission_id(
          id, 
          anonymous_id, 
          display_order,
          photos(storage_path),
          users(first_name, last_name)
        )
      `,
      )
      .order("category_id")
      .order("rank");

    if (error) throw error;

    const sanitized = (results || []).map((r) => ({
      ...r,
      author:
        (isPublished || isAdmin || isJuror) && r.submissions?.users
          ? `${r.submissions.users.first_name} ${r.submissions.users.last_name}`
          : null,
    }));

    res.json(sanitized);
  } catch (e) {
    console.error("[GET /results] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/results/compute — CALCUL DES RÉSULTATS CORRIGÉ ── */
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

    // 2. Vérifier qu'il y a des scores
    const { data: scoreCheck, error: scoreError } = await supabase
      .from("scores")
      .select("id")
      .limit(1);

    if (scoreError) {
      console.error("[COMPUTE] Erreur vérification scores:", scoreError);
    }

    if (!scoreCheck || scoreCheck.length === 0) {
      return res.status(400).json({
        error: "Aucune note saisie — impossible de calculer les résultats",
      });
    }

    console.log("[COMPUTE] Des scores existent, poursuite du calcul");

    // 3. Supprimer les anciens résultats
    const { error: deleteError } = await supabase
      .from("results")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.error(
        "[COMPUTE] Erreur suppression anciens résultats:",
        deleteError,
      );
      return res.status(500).json({ error: deleteError.message });
    }

    console.log("[COMPUTE] Anciens résultats supprimés");

    const allResults = [];

    // 4. Pour chaque catégorie, calculer les moyennes
    for (const cat of categories) {
      console.log(`[COMPUTE] Traitement de la catégorie: ${cat.name}`);

      const ranked = await computeAverages(cat.id);

      if (ranked.length === 0) {
        console.warn(
          `[COMPUTE] Catégorie "${cat.name}" sans soumissions notées, ignorée`,
        );
        continue;
      }

      console.log(
        `[COMPUTE] ${ranked.length} soumissions notées dans ${cat.name}`,
      );

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
          console.error("[COMPUTE] Erreur insertion résultat:", insertError);
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

    console.log(
      `[COMPUTE] ${allResults.length} résultats calculés avec succès`,
    );

    await log(req.user.id, "RESULTS_COMPUTE", "results", null);
    res.json({ computed: allResults.length, results: allResults });
  } catch (e) {
    console.error("[COMPUTE] Exception:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/results/publish-to-jurors ── */
router.post(
  "/publish-to-jurors",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      // Vérifier qu'il y a des résultats
      const { data: check, error: checkError } = await supabase
        .from("results")
        .select("id")
        .limit(1);

      if (checkError) throw checkError;

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
      console.error("[publish-to-jurors] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

/* ── POST /api/results/publish-to-participants ── */
router.post(
  "/publish-to-participants",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: check, error: checkError } = await supabase
        .from("results")
        .select("id")
        .limit(1);

      if (checkError) throw checkError;

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
      console.error("[publish-to-participants] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

/* ── POST /api/results/unpublish ── */
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

/* ── GET /api/results/palmares ── */
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

    // Récupérer les résultats
    const { data: results } = await supabase
      .from("results")
      .select(
        `
        rank, 
        average_score, 
        total_score, 
        category_id,
        categories(name),
        submissions!submission_id(
          id, 
          anonymous_id,
          photos(storage_path),
          users!user_id(first_name, last_name)
        )
      `,
      )
      .order("category_id")
      .order("rank");

    // Ajouter les URLs signées pour les photos
    const resultsWithUrls = await Promise.all(
      (results || []).map(async (r) => {
        let photoUrl = null;
        if (r.submissions?.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(r.submissions.photos.storage_path, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {}
        }
        return {
          ...r,
          submissions: { ...r.submissions, photoUrl },
        };
      }),
    );

    // Classement général
    const userScores = {};
    (resultsWithUrls || []).forEach((r) => {
      const u = r.submissions?.users;
      if (!u) return;
      const key = `${u.first_name} ${u.last_name}`;
      if (!userScores[key]) {
        userScores[key] = {
          name: key,
          total: 0,
          finalists: 0,
        };
      }
      userScores[key].total += r.average_score || 0;
      if (r.rank === 1) userScores[key].finalists++;
    });

    const generalRanking = Object.values(userScores).sort(
      (a, b) => b.total - a.total,
    );
    const bestPhotographer = generalRanking[0] || null;

    // Récupérer les coups de cœur
    const { data: favorites } = await supabase.from("favorites").select(`
        submission_id,
        submissions!submission_id(
          id,
          anonymous_id,
          users(first_name, last_name),
          categories(name),
          photos(storage_path)
        )
      `);

    const favoritesWithUrls = await Promise.all(
      (favorites || []).map(async (fav) => {
        let photoUrl = null;
        if (fav.submissions?.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(fav.submissions.photos.storage_path, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {}
        }
        return { ...fav, submissions: { ...fav.submissions, photoUrl } };
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

    // Toutes les soumissions pour le vote
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

    const submissionsWithUrls = await Promise.all(
      (allSubmissions || []).map(async (sub) => {
        let photoUrl = null;
        if (sub.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(sub.photos.storage_path, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {}
        }
        return { ...sub, photoUrl };
      }),
    );

    // Prix de l'œil finalisé
    const { data: eyePrizeResult } = await supabase
      .from("eye_prize_result")
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
    }

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: Object.values(favoriteCounts),
      topFavorite: topFavorite
        ? { ...topFavorite, totalFavorites: maxFavs }
        : null,
      bestPhotographer: bestPhotographer,
      allSubmissions: submissionsWithUrls || [],
      eyePrize: eyePrizeWithUrl,
      jurorsCanView,
      isPublished,
    });
  } catch (e) {
    console.error("[palmares] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   PRIX DE L'ŒIL - ROUTES
════════════════════════════════════════════════════════════════ */

router.get("/eye-prize/votes", requireAuth, requireJuror, async (req, res) => {
  try {
    const { data: votes } = await supabase.from("eye_prize_votes").select(`
        id, juror_id, submission_id, voted_at,
        submissions!submission_id(
          id, anonymous_id, users(first_name, last_name), categories(name), photos(storage_path)
        ),
        users!juror_id(first_name, last_name)
      `);

    const votesWithUrls = await Promise.all(
      (votes || []).map(async (vote) => {
        let photoUrl = null;
        if (vote.submissions?.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(vote.submissions.photos.storage_path, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {}
        }
        return { ...vote, submissions: { ...vote.submissions, photoUrl } };
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
        `*, submissions!submission_id(id, anonymous_id, users(first_name, last_name), categories(name), photos(storage_path))`,
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

// Route de diagnostic - À SUPPRIMER APRÈS DÉBOGAGE
router.get("/debug/scores", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Compter les scores
    const { count: scoresCount, error: scoresError } = await supabase
      .from("scores")
      .select("*", { count: "exact", head: true });

    // Compter les soumissions
    const { count: submissionsCount, error: subError } = await supabase
      .from("submissions")
      .select("*", { count: "exact", head: true });

    // Compter les catégories
    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("id, name, is_active");

    // Récupérer un exemple de scores
    const { data: sampleScores, error: sampleError } = await supabase
      .from("scores")
      .select(
        `
        id,
        value,
        submission_id,
        juror_id,
        submissions!inner(
          id,
          anonymous_id,
          category_id,
          categories!inner(name)
        )
      `,
      )
      .limit(5);

    res.json({
      scoresCount,
      submissionsCount,
      categories: categories || [],
      sampleScores: sampleScores || [],
      errors: {
        scoresError: scoresError?.message,
        subError: subError?.message,
        catError: catError?.message,
        sampleError: sampleError?.message,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
