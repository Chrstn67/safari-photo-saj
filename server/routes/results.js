// backend/routes/results.js - Version avec gestion améliorée des coups de cœur et prix de l'œil

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

    await supabase
      .from("results")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const allResults = [];
    let categoriesWithResults = 0;

    for (const cat of categories) {
      const ranked = await computeAverages(cat.id);

      if (ranked.length === 0) continue;

      categoriesWithResults++;

      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];

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
        allResults.push(newResult);
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

      await supabase
        .from("results")
        .update({ jurors_can_view: true })
        .neq("id", "00000000-0000-0000-0000-000000000000");

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

      await supabase
        .from("results")
        .update({
          is_published: true,
          published_at: new Date().toISOString(),
          published_by: req.user.id,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");

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
    await supabase
      .from("results")
      .update({ is_published: false, jurors_can_view: false })
      .neq("id", "00000000-0000-0000-0000-000000000000");

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

    // Récupérer les résultats
    const { data: results } = await supabase
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
            id,
            first_name,
            last_name
          )
        )
      `,
      )
      .order("category_id")
      .order("rank");

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
    // COUPS DE CŒUR - AVEC PHOTOS ET NOMS DES PARTICIPANTS
    // ════════════════════════════════════════════════════════════════
    const { data: favorites } = await supabase.from("favorites").select(`
        id,
        submission_id,
        category_id,
        created_at,
        submissions!favorites_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (
            id,
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path
          )
        ),
        users!favorites_juror_id_fkey (
          first_name,
          last_name
        )
      `);

    // Récupérer les URLs des photos pour les coups de cœur
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
          submissionId: fav.submission_id,
          categoryId: fav.category_id,
          categoryName: fav.submissions?.categories?.name,
          anonymousId: fav.submissions?.anonymous_id,
          participantName: fav.submissions?.users
            ? `${fav.submissions.users.first_name} ${fav.submissions.users.last_name}`
            : "Anonyme",
          participantId: fav.submissions?.users?.id,
          jurorName: fav.users
            ? `${fav.users.first_name} ${fav.users.last_name}`
            : "Juré",
          photoUrl: photoUrl,
          createdAt: fav.created_at,
        };
      }),
    );

    // Compter les coups de cœur par photo (avec détails)
    const favoriteCounts = {};
    favoritesWithUrls.forEach((fav) => {
      const key = fav.submissionId;
      if (!favoriteCounts[key]) {
        favoriteCounts[key] = {
          submissionId: fav.submissionId,
          anonymousId: fav.anonymousId,
          participantName: fav.participantName,
          participantId: fav.participantId,
          categoryName: fav.categoryName,
          photoUrl: fav.photoUrl,
          count: 0,
          jurorVotes: [],
        };
      }
      favoriteCounts[key].count++;
      favoriteCounts[key].jurorVotes.push({
        jurorName: fav.jurorName,
        votedAt: fav.createdAt,
      });
    });

    // Trier par nombre de votes décroissant
    const sortedFavorites = Object.values(favoriteCounts).sort(
      (a, b) => b.count - a.count,
    );
    const topFavorite = sortedFavorites[0] || null;

    // ════════════════════════════════════════════════════════════════
    // PRIX DE L'ŒIL - GESTION DES VOTES ET DES ÉGALITÉS
    // ════════════════════════════════════════════════════════════════

    // Récupérer tous les votes du prix de l'œil
    const { data: eyeVotes } = await supabase.from("eye_prize_votes").select(`
        id,
        juror_id,
        submission_id,
        voted_at,
        submissions!eye_prize_votes_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (
            id,
            first_name,
            last_name
          ),
          categories!submissions_category_id_fkey (
            name
          ),
          photos!submissions_photo_id_fkey (
            storage_path
          )
        ),
        users!eye_prize_votes_juror_id_fkey (
          first_name,
          last_name
        )
      `);

    // Récupérer le résultat finalisé
    const { data: finalEyePrize } = await supabase
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

    // Compter les votes par photo
    const eyeVoteCounts = {};
    (eyeVotes || []).forEach((vote) => {
      const key = vote.submission_id;
      if (!eyeVoteCounts[key]) {
        let photoUrl = null;
        if (vote.submissions?.photos?.storage_path) {
          // L'URL sera générée plus tard
        }
        eyeVoteCounts[key] = {
          submissionId: vote.submission_id,
          anonymousId: vote.submissions?.anonymous_id,
          participantName: vote.submissions?.users
            ? `${vote.submissions.users.first_name} ${vote.submissions.users.last_name}`
            : "Anonyme",
          categoryName: vote.submissions?.categories?.name,
          photoUrl: null,
          votes: 0,
          jurorVotes: [],
        };
      }
      eyeVoteCounts[key].votes++;
      eyeVoteCounts[key].jurorVotes.push({
        jurorId: vote.juror_id,
        jurorName: vote.users?.first_name
          ? `${vote.users.first_name} ${vote.users.last_name}`
          : "Juré",
        votedAt: vote.voted_at,
      });
    });

    // Ajouter les URLs des photos
    for (const key of Object.keys(eyeVoteCounts)) {
      const voteData = eyeVoteCounts[key];
      const { data: submission } = await supabase
        .from("submissions")
        .select("photos(storage_path)")
        .eq("id", voteData.submissionId)
        .single();

      if (submission?.photos?.storage_path) {
        try {
          const { data: signed } = await supabase.storage
            .from("photos")
            .createSignedUrl(submission.photos.storage_path, 3600);
          voteData.photoUrl = signed?.signedUrl;
        } catch (err) {}
      }
    }

    const eyeVoteList = Object.values(eyeVoteCounts).sort(
      (a, b) => b.votes - a.votes,
    );

    // Détecter s'il y a une égalité pour la première place
    let isTieForFirst = false;
    let tiedPhotos = [];
    if (eyeVoteList.length >= 2) {
      const firstVotes = eyeVoteList[0].votes;
      const secondVotes = eyeVoteList[1].votes;
      isTieForFirst = firstVotes === secondVotes;
      if (isTieForFirst) {
        tiedPhotos = eyeVoteList.filter((p) => p.votes === firstVotes);
      }
    }

    // Récupérer le vote du juré actuel
    const myEyeVote = eyeVotes?.find((v) => v.juror_id === req.user.id);

    // Récupérer le nombre total de jurés
    const { count: totalJurors } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .in("role_id", [2, 3]);

    // Formatage du prix de l'œil finalisé avec URL
    let eyePrizeFinalized = null;
    if (finalEyePrize?.submissions?.photos?.storage_path) {
      try {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(finalEyePrize.submissions.photos.storage_path, 3600);
        eyePrizeFinalized = {
          ...finalEyePrize,
          submissions: {
            ...finalEyePrize.submissions,
            photoUrl: signed?.signedUrl,
          },
        };
      } catch (err) {
        eyePrizeFinalized = finalEyePrize;
      }
    } else {
      eyePrizeFinalized = finalEyePrize;
    }

    // Toutes les soumissions pour le vote
    const { data: allSubmissions } = await supabase.from("submissions").select(`
        id,
        anonymous_id,
        category_id,
        categories!submissions_category_id_fkey (name),
        photos!submissions_photo_id_fkey (storage_path),
        users!submissions_user_id_fkey (first_name, last_name)
      `);

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
          categoryName: sub.categories?.name,
          participantName: sub.users
            ? `${sub.users.first_name} ${sub.users.last_name}`
            : "Anonyme",
          photoUrl,
        };
      }),
    );

    res.json({
      byCategory: resultsWithUrls || [],
      generalRanking: generalRanking,
      bestPhotographer: bestPhotographer,
      // Coups de cœur avec toutes les infos
      favorites: sortedFavorites,
      topFavorite: topFavorite,
      // Prix de l'œil
      eyePrize: {
        votes: eyeVoteList,
        myVote: myEyeVote
          ? {
              submissionId: myEyeVote.submission_id,
              anonymousId: myEyeVote.submissions?.anonymous_id,
              votedAt: myEyeVote.voted_at,
            }
          : null,
        isTieForFirst: isTieForFirst,
        tiedPhotos: tiedPhotos,
        totalJurors: totalJurors || 0,
        isFinalized: !!finalEyePrize,
        finalResult: eyePrizeFinalized,
      },
      allSubmissions: submissionsWithUrls,
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

// GET - Récupérer les votes
router.get("/eye-prize/votes", requireAuth, requireJuror, async (req, res) => {
  try {
    const { data: votes } = await supabase.from("eye_prize_votes").select(`
        id,
        juror_id,
        submission_id,
        voted_at,
        submissions!eye_prize_votes_submission_id_fkey (
          id,
          anonymous_id,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
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
        `*, submissions!eye_prize_result_submission_id_fkey (id, anonymous_id, users(first_name, last_name), categories(name), photos(storage_path))`,
      )
      .eq("is_finalized", true)
      .maybeSingle();

    const { count: totalJurors } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .in("role_id", [2, 3]);

    res.json({
      voteCounts: Object.values(voteCounts),
      myVote: myVote || null,
      finalResult,
      totalJurors: totalJurors || 0,
    });
  } catch (e) {
    console.error("[eye-prize/votes] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST - Voter pour le prix de l'œil
router.post("/eye-prize/vote", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId)
    return res.status(400).json({ error: "submissionId requis" });

  try {
    const { data: submission } = await supabase
      .from("submissions")
      .select("id, category_id")
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

// POST - Finaliser le prix de l'œil (admin seulement)
router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;
    if (!submissionId)
      return res.status(400).json({ error: "submissionId requis" });

    try {
      // Supprimer l'ancien résultat s'il existe
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

      await log(
        req.user.id,
        "EYE_PRIZE_FINALIZED",
        "eye_prize_result",
        result.id,
        {
          submissionId,
        },
      );

      res.json({ success: true, message: "Prix de l'œil finalisé !" });
    } catch (e) {
      console.error("[eye-prize/finalize] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// POST - Réinitialiser tous les votes (admin seulement)
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

    await log(req.user.id, "EYE_PRIZE_RESET", "eye_prize_votes", null);
    res.json({ success: true, message: "Votes réinitialisés" });
  } catch (e) {
    console.error("[eye-prize/reset] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
