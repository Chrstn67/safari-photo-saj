// backend/routes/results.js - Version complète avec gestion des égalités
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

// ════════════════════════════════════════════════════════════════
// FONCTION DE CALCUL DES MOYENNES
// ════════════════════════════════════════════════════════════════
async function computeAverages(categoryId) {
  console.log(`[computeAverages] Catégorie ${categoryId}`);

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
    return [];
  }

  const results = [];

  for (const sub of submissions) {
    const { data: scores, error: scoreError } = await supabase
      .from("scores")
      .select("value, juror_id")
      .eq("submission_id", sub.id);

    if (scoreError || !scores || scores.length === 0) {
      continue;
    }

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

  return results.sort((a, b) => b.average - a.average);
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
// POST /api/results/compute
// ════════════════════════════════════════════════════════════════
router.post("/compute", requireAuth, requireAdmin, async (req, res) => {
  console.log("[COMPUTE] Début du calcul des résultats");

  try {
    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true);

    if (catError) {
      return res.status(500).json({ error: catError.message });
    }

    if (!categories || categories.length === 0) {
      return res.status(400).json({ error: "Aucune catégorie active" });
    }

    const { error: deleteError } = await supabase
      .from("results")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    const allResults = [];
    let categoriesWithResults = 0;

    for (const cat of categories) {
      const ranked = await computeAverages(cat.id);

      if (ranked.length === 0) {
        continue;
      }

      categoriesWithResults++;

      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];

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
          "Aucun résultat calculé — vérifiez que des notes ont été saisies",
      });
    }

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
// GET /api/results/palmares - Version complète avec photos pour coups de cœur
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

    // Récupérer les résultats
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
          } catch (err) {}
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

    // Classement général
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

    // ════════════════════════════════════════════════════════════════
    // COUPS DE CŒUR - AVEC PHOTOS COMPLÈTES
    // ════════════════════════════════════════════════════════════════
    const { data: favorites, error: favError } = await supabase.from(
      "favorites",
    ).select(`
        id,
        submission_id,
        category_id,
        created_at,
        submissions!favorites_submission_id_fkey (
          id,
          anonymous_id,
          display_order,
          users!submissions_user_id_fkey (
            id,
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            id,
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path,
            filename
          )
        )
      `);

    if (favError) {
      console.error("[palmares] Erreur favorites:", favError);
    }

    // Construire la liste des coups de cœur avec photos et noms
    const favoriteItems = await Promise.all(
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
          id: fav.id,
          submissionId: fav.submission_id,
          categoryId: fav.category_id,
          categoryName: fav.submissions?.categories?.name,
          anonymousId: fav.submissions?.anonymous_id,
          author: fav.submissions?.users
            ? `${fav.submissions.users.first_name} ${fav.submissions.users.last_name}`
            : null,
          photoUrl: photoUrl,
          createdAt: fav.created_at,
        };
      }),
    );

    // Compter les coups de cœur par photo
    const favoriteCountsMap = new Map();
    favoriteItems.forEach((item) => {
      const key = item.submissionId;
      if (!favoriteCountsMap.has(key)) {
        favoriteCountsMap.set(key, {
          submissionId: item.submissionId,
          anonymousId: item.anonymousId,
          author: item.author,
          photoUrl: item.photoUrl,
          categoryName: item.categoryName,
          count: 0,
          favorites: [],
        });
      }
      const entry = favoriteCountsMap.get(key);
      entry.count++;
      entry.favorites.push({
        jurorName: null, // On garde l'anonymat du jury
        votedAt: item.createdAt,
      });
    });

    const favoriteCounts = Array.from(favoriteCountsMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    const topFavorite = favoriteCounts.length > 0 ? favoriteCounts[0] : null;

    // ════════════════════════════════════════════════════════════════
    // PRIX DE L'ŒIL - AVEC GESTION DES ÉGALITÉS
    // ════════════════════════════════════════════════════════════════

    // Récupérer l'état du vote (en cours ou finalisé)
    const { data: tieState } = await supabase
      .from("eye_prize_state")
      .select("*")
      .limit(1)
      .maybeSingle();

    // Récupérer tous les votes
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

    if (votesError) {
      console.error("[palmares] Erreur votes:", votesError);
    }

    // Ajouter les URLs aux votes
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

    // Compter les votes par photo
    const voteCountsMap = new Map();
    votesWithUrls.forEach((vote) => {
      const key = vote.submission_id;
      if (!voteCountsMap.has(key)) {
        voteCountsMap.set(key, {
          submissionId: vote.submission_id,
          anonymousId: vote.submissions?.anonymous_id,
          author: vote.submissions?.users
            ? `${vote.submissions.users.first_name} ${vote.submissions.users.last_name}`
            : null,
          photoUrl: vote.submissions?.photoUrl,
          categoryName: vote.submissions?.categories?.name,
          votes: 0,
          jurorIds: [],
        });
      }
      const entry = voteCountsMap.get(key);
      entry.votes++;
      entry.jurorIds.push(vote.juror_id);
    });

    const voteCounts = Array.from(voteCountsMap.values()).sort(
      (a, b) => b.votes - a.votes,
    );

    // Vérifier s'il y a une égalité
    let hasTie = false;
    let tiedPhotos = [];
    if (voteCounts.length >= 2 && voteCounts[0].votes === voteCounts[1].votes) {
      hasTie = true;
      const topVoteCount = voteCounts[0].votes;
      tiedPhotos = voteCounts.filter((v) => v.votes === topVoteCount);
    }

    // Récupérer le résultat finalisé
    const { data: finalResult } = await supabase
      .from("eye_prize_result")
      .select(
        `
        id,
        total_votes,
        is_finalized,
        finalized_at,
        finalized_by,
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

    let finalResultWithUrl = null;
    if (finalResult?.submissions?.photos?.storage_path) {
      try {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(finalResult.submissions.photos.storage_path, 3600);
        finalResultWithUrl = {
          ...finalResult,
          submissions: {
            ...finalResult.submissions,
            photoUrl: signed?.signedUrl,
          },
        };
      } catch (err) {
        finalResultWithUrl = finalResult;
      }
    } else {
      finalResultWithUrl = finalResult;
    }

    // Mon vote
    const myVote = votesWithUrls?.find((v) => v.juror_id === req.user.id);

    // Toutes les soumissions pour le modal de vote
    const { data: allSubmissions } = await supabase
      .from("submissions")
      .select(
        `
        id,
        anonymous_id,
        display_order,
        category_id,
        categories!submissions_category_id_fkey (
          name
        ),
        photos!submissions_photo_id_fkey (
          storage_path
        ),
        users!submissions_user_id_fkey (
          first_name,
          last_name
        )
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
        return {
          id: sub.id,
          anonymous_id: sub.anonymous_id,
          display_order: sub.display_order,
          category_id: sub.category_id,
          categoryName: sub.categories?.name,
          photoUrl: photoUrl,
          author: sub.users
            ? `${sub.users.first_name} ${sub.users.last_name}`
            : null,
        };
      }),
    );

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: favoriteCounts,
      topFavorite: topFavorite,
      bestPhotographer: bestPhotographer,
      generalRanking: generalRanking,
      allSubmissions: submissionsWithUrls || [],
      eyePrize: finalResultWithUrl,
      eyePrizeVotes: voteCounts,
      eyePrizeHasTie: hasTie,
      eyePrizeTiedPhotos: tiedPhotos,
      eyePrizeState: tieState,
      myEyePrizeVote: myVote || null,
      jurorsCanView,
      isPublished,
    });
  } catch (e) {
    console.error("[palmares] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PRIX DE L'ŒIL - ROUTES AVEC GESTION DES ÉGALITÉS
// ════════════════════════════════════════════════════════════════

// GET /api/results/eye-prize/votes
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

    const { data: tieState } = await supabase
      .from("eye_prize_state")
      .select("*")
      .limit(1)
      .maybeSingle();

    const { data: allJurors } = await supabase
      .from("users")
      .select("id")
      .in("role_id", [2, 3]);

    res.json({
      voteCounts: Object.values(voteCounts),
      myVote: myVote || null,
      finalResult,
      tieState,
      totalJurors: allJurors?.length || 0,
    });
  } catch (e) {
    console.error("[eye-prize/votes] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/results/eye-prize/vote
router.post("/eye-prize/vote", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId)
    return res.status(400).json({ error: "submissionId requis" });

  try {
    // Vérifier si le vote est déjà finalisé
    const { data: existingResult } = await supabase
      .from("eye_prize_result")
      .select("is_finalized")
      .eq("is_finalized", true)
      .maybeSingle();

    if (existingResult) {
      return res
        .status(403)
        .json({ error: "Le Prix de l'œil a déjà été finalisé" });
    }

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

    // Mettre à jour le compteur
    await updateEyePrizeCounts();

    res.json({ success: true, message: "Vote enregistré !" });
  } catch (e) {
    console.error("[eye-prize/vote] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// Fonction pour mettre à jour les compteurs
async function updateEyePrizeCounts() {
  const { data: votes } = await supabase
    .from("eye_prize_votes")
    .select("submission_id");

  const counts = {};
  (votes || []).forEach((v) => {
    counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
  });

  for (const [subId, count] of Object.entries(counts)) {
    await supabase.from("eye_prize_result").upsert({
      submission_id: subId,
      total_votes: count,
      is_finalized: false,
    });
  }
}

// POST /api/results/eye-prize/resolve-tie - Pour résoudre une égalité
router.post(
  "/eye-prize/resolve-tie",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { winningSubmissionId } = req.body;
    if (!winningSubmissionId) {
      return res.status(400).json({ error: "winningSubmissionId requis" });
    }

    try {
      // Récupérer les votes actuels
      const { data: votes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");

      const counts = {};
      (votes || []).forEach((v) => {
        counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
      });

      const maxVotes = Math.max(...Object.values(counts));
      const tiedSubmissions = Object.entries(counts)
        .filter(([, count]) => count === maxVotes)
        .map(([id]) => id);

      if (!tiedSubmissions.includes(winningSubmissionId)) {
        return res
          .status(400)
          .json({ error: "Cette photo n'est pas parmi les ex-aequo" });
      }

      // Finaliser avec le choix de l'admin
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      const { data: result } = await supabase
        .from("eye_prize_result")
        .insert({
          submission_id: winningSubmissionId,
          total_votes: counts[winningSubmissionId],
          is_finalized: true,
          finalized_at: new Date().toISOString(),
          finalized_by: req.user.id,
        })
        .select()
        .single();

      // Enregistrer l'état de l'égalité résolue
      await supabase.from("eye_prize_state").upsert({
        id: 1,
        has_tie: false,
        resolved_at: new Date().toISOString(),
        resolved_by: req.user.id,
        winning_submission_id: winningSubmissionId,
      });

      await log(
        req.user.id,
        "EYE_PRIZE_TIE_RESOLVED",
        "eye_prize_result",
        winningSubmissionId,
        {
          tieBroken: true,
          finalChoice: winningSubmissionId,
        },
      );

      res.json({
        success: true,
        message: "Égalité résolue - Prix de l'œil finalisé !",
      });
    } catch (e) {
      console.error("[eye-prize/resolve-tie] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// POST /api/results/eye-prize/finalize - Finalisation normale (sans égalité)
router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;
    if (!submissionId) {
      // Si pas de submissionId, prendre le gagnant automatique
      try {
        const { data: votes } = await supabase
          .from("eye_prize_votes")
          .select("submission_id");

        const counts = {};
        (votes || []).forEach((v) => {
          counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
        });

        let maxVotes = 0;
        let winner = null;
        for (const [id, count] of Object.entries(counts)) {
          if (count > maxVotes) {
            maxVotes = count;
            winner = id;
          }
        }

        if (!winner) {
          return res.status(400).json({ error: "Aucun vote enregistré" });
        }

        await supabase
          .from("eye_prize_result")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");

        const { data: result } = await supabase
          .from("eye_prize_result")
          .insert({
            submission_id: winner,
            total_votes: maxVotes,
            is_finalized: true,
            finalized_at: new Date().toISOString(),
            finalized_by: req.user.id,
          })
          .select()
          .single();

        await supabase.from("eye_prize_state").upsert({
          id: 1,
          has_tie: false,
          resolved_at: new Date().toISOString(),
          resolved_by: req.user.id,
          winning_submission_id: winner,
        });

        res.json({ success: true, message: "Prix de l'œil finalisé !" });
      } catch (e) {
        console.error("[eye-prize/finalize] Erreur:", e);
        res.status(500).json({ error: e.message });
      }
      return;
    }

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

      await supabase.from("eye_prize_state").upsert({
        id: 1,
        has_tie: false,
        resolved_at: new Date().toISOString(),
        resolved_by: req.user.id,
        winning_submission_id: submissionId,
      });

      await log(
        req.user.id,
        "EYE_PRIZE_FINALIZED",
        "eye_prize_result",
        submissionId,
      );
      res.json({ success: true, message: "Prix de l'œil finalisé !" });
    } catch (e) {
      console.error("[eye-prize/finalize] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// POST /api/results/eye-prize/reset
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
    await supabase
      .from("eye_prize_state")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    res.json({ success: true, message: "Votes réinitialisés" });
  } catch (e) {
    console.error("[eye-prize/reset] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
