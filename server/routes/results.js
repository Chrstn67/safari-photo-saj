// backend/routes/results.js - Version complète avec gestion des votes et égalités
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

  if (subError || !submissions?.length) return [];

  const results = [];

  for (const sub of submissions) {
    const { data: scores, error: scoreError } = await supabase
      .from("scores")
      .select("value, juror_id")
      .eq("submission_id", sub.id);

    if (scoreError || !scores?.length) continue;

    const byJuror = {};
    scores.forEach((s) => {
      if (!byJuror[s.juror_id]) byJuror[s.juror_id] = 0;
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

    if (catError || !categories?.length) {
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
      console.log(`[COMPUTE] ${ranked.length} résultats pour ${cat.name}`);

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

        if (insertError) throw insertError;
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
        return res.status(400).json({ error: "Aucun résultat calculé." });
      }

      await supabase
        .from("results")
        .update({ jurors_can_view: true })
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await log(req.user.id, "RESULTS_PUBLISH_TO_JURORS", "results", null);
      res.json({ success: true });
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
        return res.status(400).json({ error: "Aucun résultat calculé." });
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
      res.json({ success: true });
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
    res.json({ success: true });
  } catch (e) {
    console.error("[unpublish] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/results/palmares - Version avec détails des coups de cœur
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
        id, rank, average_score, total_score, category_id,
        categories!results_category_id_fkey (id, name),
        submissions!results_submission_id_fkey (
          id, anonymous_id, display_order, photo_id,
          photos!submissions_photo_id_fkey (storage_path),
          users!submissions_user_id_fkey (first_name, last_name)
        )
      `,
      )
      .order("category_id")
      .order("rank");

    // Ajouter les URLs
    const resultsWithUrls = await Promise.all(
      (results || []).map(async (r) => {
        let photoUrl = null;
        const storagePath = r.submissions?.photos?.storage_path;
        if (storagePath) {
          const { data: signed } = await supabase.storage
            .from("photos")
            .createSignedUrl(storagePath, 3600);
          photoUrl = signed?.signedUrl;
        }
        return {
          ...r,
          author: r.submissions?.users
            ? `${r.submissions.users.first_name} ${r.submissions.users.last_name}`
            : null,
          submissions: { ...r.submissions, photoUrl },
        };
      }),
    );

    // Classement général
    const userScores = {};
    resultsWithUrls.forEach((r) => {
      const author = r.author;
      if (!author) return;
      if (!userScores[author])
        userScores[author] = { name: author, total: 0, finalists: 0 };
      userScores[author].total += r.average_score || 0;
      if (r.rank === 1) userScores[author].finalists++;
    });
    const generalRanking = Object.values(userScores).sort(
      (a, b) => b.total - a.total,
    );

    // ════════════════════════════════════════════════════════════════
    // COUPS DE CŒUR - Version avec DÉTAILS complets (photos + participants)
    // ════════════════════════════════════════════════════════════════
    const { data: favorites } = await supabase.from("favorites").select(`
        id, submission_id, category_id, created_at,
        juror_id,
        users!favorites_juror_id_fkey (first_name, last_name),
        submissions!favorites_submission_id_fkey (
          id, anonymous_id, display_order,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `);

    // Grouper par soumission pour compter les votes
    const favoritesBySubmission = {};
    const favoritesList = [];

    for (const fav of favorites || []) {
      const storagePath = fav.submissions?.photos?.storage_path;
      let photoUrl = null;
      if (storagePath) {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(storagePath, 3600);
        photoUrl = signed?.signedUrl;
      }

      const authorName = fav.submissions?.users
        ? `${fav.submissions.users.first_name} ${fav.submissions.users.last_name}`
        : "Anonyme";

      const jurorName = fav.users
        ? `${fav.users.first_name} ${fav.users.last_name}`
        : "Juré";

      if (!favoritesBySubmission[fav.submission_id]) {
        favoritesBySubmission[fav.submission_id] = {
          submissionId: fav.submission_id,
          anonymousId: fav.submissions?.anonymous_id,
          author: authorName,
          categoryName: fav.submissions?.categories?.name,
          photoUrl: photoUrl,
          jurorVotes: [],
          voteCount: 0,
        };
      }
      favoritesBySubmission[fav.submission_id].jurorVotes.push({
        jurorId: fav.juror_id,
        jurorName: jurorName,
        votedAt: fav.created_at,
      });
      favoritesBySubmission[fav.submission_id].voteCount++;
    }

    // Convertir en tableau et trier par nombre de votes
    const favoriteCounts = Object.values(favoritesBySubmission).sort(
      (a, b) => b.voteCount - a.voteCount,
    );
    const topFavorite = favoriteCounts[0] || null;

    // Prix de l'œil finalisé
    const { data: eyePrizeResult } = await supabase
      .from("eye_prize_result")
      .select(
        `
        *, total_votes, is_finalized, finalized_at,
        submissions!eye_prize_result_submission_id_fkey (
          id, anonymous_id,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `,
      )
      .eq("is_finalized", true)
      .maybeSingle();

    let eyePrizeWithUrl = null;
    if (eyePrizeResult?.submissions?.photos?.storage_path) {
      const { data: signed } = await supabase.storage
        .from("photos")
        .createSignedUrl(eyePrizeResult.submissions.photos.storage_path, 3600);
      eyePrizeWithUrl = {
        ...eyePrizeResult,
        submissions: {
          ...eyePrizeResult.submissions,
          photoUrl: signed?.signedUrl,
        },
      };
    }

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: favoriteCounts,
      topFavorite: topFavorite,
      bestPhotographer: generalRanking[0] || null,
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
// PRIX DE L'ŒIL - ROUTES COMPLÈTES avec gestion des égalités
// ════════════════════════════════════════════════════════════════

// GET /api/results/eye-prize/votes - Récupérer tous les votes
router.get("/eye-prize/votes", requireAuth, requireJuror, async (req, res) => {
  try {
    // Récupérer tous les votes
    const { data: votes, error: votesError } = await supabase.from(
      "eye_prize_votes",
    ).select(`
        id, juror_id, submission_id, voted_at,
        users!eye_prize_votes_juror_id_fkey (first_name, last_name),
        submissions!eye_prize_votes_submission_id_fkey (
          id, anonymous_id,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `);

    if (votesError) throw votesError;

    // Ajouter les URLs des photos
    const votesWithUrls = await Promise.all(
      (votes || []).map(async (vote) => {
        let photoUrl = null;
        const storagePath = vote.submissions?.photos?.storage_path;
        if (storagePath) {
          const { data: signed } = await supabase.storage
            .from("photos")
            .createSignedUrl(storagePath, 3600);
          photoUrl = signed?.signedUrl;
        }
        return {
          ...vote,
          submissions: { ...vote.submissions, photoUrl },
        };
      }),
    );

    // Compter les votes par soumission
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
          categoryName: vote.submissions?.categories?.name,
          photoUrl: vote.submissions?.photoUrl,
          votes: 0,
          jurorIds: [],
        };
      }
      voteCounts[key].votes++;
      voteCounts[key].jurorIds.push(vote.juror_id);
    });

    // Vérifier s'il y a une égalité
    const voteCountsArray = Object.values(voteCounts);
    const sortedByVotes = [...voteCountsArray].sort(
      (a, b) => b.votes - a.votes,
    );
    const hasTie =
      sortedByVotes.length > 1 &&
      sortedByVotes[0].votes === sortedByVotes[1]?.votes;

    // Mon vote
    const myVote = votesWithUrls?.find((v) => v.juror_id === req.user.id);

    // Résultat finalisé
    const { data: finalResult } = await supabase
      .from("eye_prize_result")
      .select(
        `
        *, total_votes,
        submissions!eye_prize_result_submission_id_fkey (
          id, anonymous_id,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `,
      )
      .eq("is_finalized", true)
      .maybeSingle();

    let finalResultWithUrl = null;
    if (finalResult?.submissions?.photos?.storage_path) {
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
    }

    // Récupérer tous les jurés
    const { data: allJurors } = await supabase
      .from("users")
      .select("id, first_name, last_name")
      .in("role_id", [2, 3]);
    const jurorsWhoVoted = votesWithUrls.map((v) => v.juror_id);
    const jurorsMissing = (allJurors || []).filter(
      (j) => !jurorsWhoVoted.includes(j.id),
    );

    res.json({
      voteCounts: sortedByVotes,
      myVote: myVote || null,
      finalResult: finalResultWithUrl,
      totalJurors: allJurors?.length || 0,
      hasTie: hasTie,
      jurorsWhoVoted: jurorsWhoVoted,
      jurorsMissing: jurorsMissing,
    });
  } catch (e) {
    console.error("[eye-prize/votes] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/results/eye-prize/vote - Voter pour une photo
router.post("/eye-prize/vote", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId)
    return res.status(400).json({ error: "submissionId requis" });

  try {
    // Vérifier si le prix n'est pas déjà finalisé
    const { data: existingFinal } = await supabase
      .from("eye_prize_result")
      .select("id")
      .eq("is_finalized", true)
      .maybeSingle();

    if (existingFinal) {
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

    // Upsert du vote
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

    // Mettre à jour le compteur total dans eye_prize_result
    const { data: allVotes } = await supabase
      .from("eye_prize_votes")
      .select("submission_id");

    const voteCounts = {};
    (allVotes || []).forEach((v) => {
      voteCounts[v.submission_id] = (voteCounts[v.submission_id] || 0) + 1;
    });

    // Supprimer l'ancien résultat non finalisé et créer/update le nouveau
    await supabase.from("eye_prize_result").delete().eq("is_finalized", false);

    for (const [subId, count] of Object.entries(voteCounts)) {
      await supabase.from("eye_prize_result").upsert(
        {
          submission_id: subId,
          total_votes: count,
          is_finalized: false,
        },
        { onConflict: "submission_id" },
      );
    }

    res.json({ success: true, message: "Vote enregistré !" });
  } catch (e) {
    console.error("[eye-prize/vote] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/results/eye-prize/finalize - Finaliser le prix (avec gestion égalité)
router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId, forceTie = false } = req.body;
    if (!submissionId && !forceTie) {
      return res.status(400).json({ error: "submissionId requis" });
    }

    try {
      // Récupérer tous les votes
      const { data: allVotes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");
      const voteCounts = {};
      (allVotes || []).forEach((v) => {
        voteCounts[v.submission_id] = (voteCounts[v.submission_id] || 0) + 1;
      });

      const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
      const hasTie = sorted.length > 1 && sorted[0][1] === sorted[1][1];

      if (hasTie && !forceTie) {
        // Récupérer les photos en égalité
        const tiedSubmissions = [];
        const topVotes = sorted[0][1];
        for (const [subId, votes] of sorted) {
          if (votes === topVotes) {
            const { data: sub } = await supabase
              .from("submissions")
              .select(
                "id, anonymous_id, users(first_name, last_name), categories(name), photos(storage_path)",
              )
              .eq("id", subId)
              .single();

            let photoUrl = null;
            if (sub?.photos?.storage_path) {
              const { data: signed } = await supabase.storage
                .from("photos")
                .createSignedUrl(sub.photos.storage_path, 3600);
              photoUrl = signed?.signedUrl;
            }
            tiedSubmissions.push({
              ...sub,
              photoUrl,
              votes: topVotes,
            });
          }
        }
        return res.status(409).json({
          error: "Égalité détectée",
          hasTie: true,
          tiedSubmissions: tiedSubmissions,
          message:
            "Plusieurs photos ont le même nombre de votes. Le jury doit délibérer.",
        });
      }

      // Supprimer tous les résultats non finalisés
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      // Créer le résultat finalisé
      const { data: result } = await supabase
        .from("eye_prize_result")
        .insert({
          submission_id: submissionId,
          total_votes: voteCounts[submissionId] || 0,
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
          totalVotes: voteCounts[submissionId] || 0,
        },
      );

      res.json({ success: true, message: "Prix de l'œil finalisé !", result });
    } catch (e) {
      console.error("[eye-prize/finalize] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// POST /api/results/eye-prize/reset - Réinitialiser tous les votes
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
    await log(req.user.id, "EYE_PRIZE_RESET", "eye_prize_result", null);
    res.json({ success: true, message: "Votes réinitialisés" });
  } catch (e) {
    console.error("[eye-prize/reset] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
