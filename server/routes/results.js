// backend/routes/results.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

// ════════════════════════════════════════════════════════════════
// FONCTION DE CALCUL DES MOYENNES
// ════════════════════════════════════════════════════════════════
async function computeAverages(categoryId) {
  const { data: submissions } = await supabase
    .from("submissions")
    .select("id, anonymous_id, display_order, user_id")
    .eq("category_id", categoryId);

  if (!submissions?.length) return [];

  const results = [];

  for (const sub of submissions) {
    const { data: scores } = await supabase
      .from("scores")
      .select("value, juror_id")
      .eq("submission_id", sub.id);

    if (!scores?.length) continue;

    const byJuror = {};
    scores.forEach((s) => {
      byJuror[s.juror_id] = (byJuror[s.juror_id] || 0) + s.value;
    });

    const jurorTotals = Object.values(byJuror);
    const avg = jurorTotals.length
      ? jurorTotals.reduce((a, b) => a + b, 0) / jurorTotals.length
      : 0;

    results.push({
      submissionId: sub.id,
      anonymousId: sub.anonymous_id,
      displayOrder: sub.display_order,
      userId: sub.user_id,
      average: Math.round(avg * 100) / 100,
      totalScore: jurorTotals.reduce((a, b) => a + b, 0),
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
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/results/compute
// ════════════════════════════════════════════════════════════════
router.post("/compute", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true);

    if (!categories?.length) {
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
        const { data: newResult } = await supabase
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
        allResults.push(newResult);
      }
    }

    if (allResults.length === 0) {
      return res.status(400).json({ error: "Aucun résultat calculé" });
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
    console.error("[COMPUTE]", e);
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
        return res.status(400).json({ error: "Aucun résultat calculé" });
      }

      await supabase
        .from("results")
        .update({ jurors_can_view: true })
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await log(req.user.id, "RESULTS_PUBLISH_TO_JURORS", "results", null);
      res.json({ success: true });
    } catch (e) {
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
        return res.status(400).json({ error: "Aucun résultat calculé" });
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

    const canSeePhotographerNames =
      isAdmin || (isJuror && jurorsCanView) || (isParticipant && isPublished);
    const canViewResults =
      isAdmin || (isJuror && jurorsCanView) || (isParticipant && isPublished);

    if (!canViewResults) {
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

        const author =
          canSeePhotographerNames && r.submissions?.users
            ? `${r.submissions.users.first_name} ${r.submissions.users.last_name}`
            : null;

        return {
          ...r,
          author,
          submissions: { ...r.submissions, photoUrl },
        };
      }),
    );

    // Classement général
    const userScores = {};
    resultsWithUrls.forEach((r) => {
      const key =
        r.author || r.submissions?.anonymous_id || `Photo ${r.submissions?.id}`;
      if (!userScores[key])
        userScores[key] = { name: key, total: 0, finalists: 0 };
      userScores[key].total += r.average_score || 0;
      if (r.rank === 1) userScores[key].finalists++;
    });
    const generalRanking = Object.values(userScores).sort(
      (a, b) => b.total - a.total,
    );
    const bestPhotographer = canSeePhotographerNames
      ? generalRanking[0] || null
      : null;

    // ════════════════════════════════════════════════════════════════
    // COUPS DE CŒUR
    // ════════════════════════════════════════════════════════════════
    let favoriteCounts = [];

    if (isAdmin) {
      const { data: favorites } = await supabase.from("favorites").select(`
          id, submission_id, category_id, created_at,
          juror_id,
          jurors:users!favorites_juror_id_fkey (first_name, last_name),
          submissions!favorites_submission_id_fkey (
            id, anonymous_id,
            users!submissions_user_id_fkey (first_name, last_name),
            categories!submissions_category_id_fkey (id, name),
            photos!submissions_photo_id_fkey (storage_path)
          )
        `);

      const favoritesWithJurors = await Promise.all(
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
            jurorName: fav.jurors
              ? `${fav.jurors.first_name} ${fav.jurors.last_name}`
              : "Inconnu",
            photographerName: fav.submissions?.users
              ? `${fav.submissions.users.first_name} ${fav.submissions.users.last_name}`
              : fav.submissions?.anonymous_id,
            anonymousId: fav.submissions?.anonymous_id,
            categoryName: fav.submissions?.categories?.name,
            photoUrl: photoUrl,
            createdAt: fav.created_at,
          };
        }),
      );

      const countMap = new Map();
      favoritesWithJurors.forEach((fav) => {
        const key = fav.submissionId;
        if (!countMap.has(key)) {
          countMap.set(key, {
            submissionId: fav.submissionId,
            photographerName: fav.photographerName,
            anonymousId: fav.anonymousId,
            photoUrl: fav.photoUrl,
            categoryName: fav.categoryName,
            count: 0,
            jurors: [],
          });
        }
        const entry = countMap.get(key);
        entry.count++;
        entry.jurors.push({ name: fav.jurorName, votedAt: fav.createdAt });
      });
      favoriteCounts = Array.from(countMap.values()).sort(
        (a, b) => b.count - a.count,
      );
    } else {
      const { data: favorites } = await supabase.from("favorites").select(`
          id, submission_id,
          submissions!favorites_submission_id_fkey (
            id, anonymous_id,
            categories!submissions_category_id_fkey (name),
            photos!submissions_photo_id_fkey (storage_path)
          )
        `);

      const items = await Promise.all(
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
            anonymousId: fav.submissions?.anonymous_id,
            categoryName: fav.submissions?.categories?.name,
            photoUrl: photoUrl,
          };
        }),
      );

      const countMap = new Map();
      items.forEach((item) => {
        const key = item.submissionId;
        if (!countMap.has(key)) {
          countMap.set(key, {
            submissionId: item.submissionId,
            anonymousId: item.anonymousId,
            photoUrl: item.photoUrl,
            categoryName: item.categoryName,
            count: 0,
          });
        }
        countMap.get(key).count++;
      });
      favoriteCounts = Array.from(countMap.values()).sort(
        (a, b) => b.count - a.count,
      );
    }

    // ════════════════════════════════════════════════════════════════
    // PRIX DE L'ŒIL
    // ════════════════════════════════════════════════════════════════

    // Récupérer toutes les soumissions pour les votes
    const { data: allSubmissions } = await supabase.from("submissions").select(`
        id, anonymous_id, category_id,
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
          photoUrl: photoUrl,
        };
      }),
    );

    // Récupérer les votes
    const { data: eyePrizeVotes } = await supabase
      .from("eye_prize_votes")
      .select("id, juror_id, submission_id, voted_at");

    // Compter les votes par photo
    const voteCountsMap = new Map();
    (eyePrizeVotes || []).forEach((vote) => {
      const sub = submissionsWithUrls.find((s) => s.id === vote.submission_id);
      const key = vote.submission_id;
      if (!voteCountsMap.has(key) && sub) {
        voteCountsMap.set(key, {
          submissionId: key,
          anonymousId: sub.anonymous_id,
          photoUrl: sub.photoUrl,
          categoryName: sub.categoryName,
          votes: 0,
        });
      }
      if (voteCountsMap.has(key)) {
        voteCountsMap.get(key).votes++;
      }
    });

    const voteCounts = Array.from(voteCountsMap.values()).sort(
      (a, b) => b.votes - a.votes,
    );

    // Vérifier l'égalité
    let hasTie = false;
    let tiedPhotos = [];
    if (
      voteCounts.length >= 2 &&
      voteCounts[0]?.votes === voteCounts[1]?.votes &&
      voteCounts[0]?.votes > 0
    ) {
      hasTie = true;
      const topVoteCount = voteCounts[0].votes;
      tiedPhotos = voteCounts.filter((v) => v.votes === topVoteCount);
    }

    // Récupérer le résultat finalisé
    const { data: finalResult } = await supabase
      .from("eye_prize_result")
      .select(
        `
        id, total_votes, is_finalized, finalized_at,
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
      } catch (err) {}
    }

    const myVote = eyePrizeVotes?.find((v) => v.juror_id === req.user.id);
    const myVoteDetails = myVote
      ? submissionsWithUrls.find((s) => s.id === myVote.submission_id)
      : null;

    const { count: jurorsCount } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .in("role_id", [2, 3]);

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: favoriteCounts,
      bestPhotographer: bestPhotographer,
      generalRanking: generalRanking,
      allSubmissions: submissionsWithUrls || [],
      eyePrize: finalResultWithUrl,
      eyePrizeVotes: voteCounts,
      eyePrizeHasTie: hasTie,
      eyePrizeTiedPhotos: tiedPhotos,
      myEyePrizeVote: myVoteDetails
        ? { submission_id: myVote.submission_id, ...myVoteDetails }
        : null,
      totalJurors: jurorsCount || 0,
      jurorsCanView,
      isPublished,
    });
  } catch (e) {
    console.error("[palmares] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PRIX DE L'ŒIL - ROUTES DE VOTE
// ════════════════════════════════════════════════════════════════

router.get("/eye-prize/votes", requireAuth, requireJuror, async (req, res) => {
  try {
    const { data: votes } = await supabase.from("eye_prize_votes").select("*");

    const { data: submissions } = await supabase.from("submissions").select(`
        id, anonymous_id,
        categories!submissions_category_id_fkey (name),
        photos!submissions_photo_id_fkey (storage_path)
      `);

    const submissionsWithUrls = await Promise.all(
      (submissions || []).map(async (sub) => {
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
          anonymousId: sub.anonymous_id,
          categoryName: sub.categories?.name,
          photoUrl: photoUrl,
        };
      }),
    );

    const voteCounts = {};
    (votes || []).forEach((vote) => {
      const sub = submissionsWithUrls.find((s) => s.id === vote.submission_id);
      const key = vote.submission_id;
      if (!voteCounts[key] && sub) {
        voteCounts[key] = {
          submissionId: vote.submission_id,
          anonymousId: sub.anonymousId,
          photoUrl: sub.photoUrl,
          votes: 0,
        };
      }
      if (voteCounts[key]) voteCounts[key].votes++;
    });

    const myVote = votes?.find((v) => v.juror_id === req.user.id);
    const myVoteDetails = myVote
      ? submissionsWithUrls.find((s) => s.id === myVote.submission_id)
      : null;

    const { data: finalResult } = await supabase
      .from("eye_prize_result")
      .select("*")
      .eq("is_finalized", true)
      .maybeSingle();

    res.json({
      voteCounts: Object.values(voteCounts),
      myVote: myVoteDetails
        ? { submission_id: myVote.submission_id, ...myVoteDetails }
        : null,
      finalResult,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/eye-prize/vote", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId)
    return res.status(400).json({ error: "submissionId requis" });

  try {
    // Vérifier si le prix est déjà finalisé
    const { data: existingResult } = await supabase
      .from("eye_prize_result")
      .select("is_finalized")
      .eq("is_finalized", true)
      .maybeSingle();

    if (existingResult) {
      return res
        .status(403)
        .json({
          error: "Le Prix de l'œil a déjà été finalisé, les votes sont clos",
        });
    }

    const { data: submission } = await supabase
      .from("submissions")
      .select("id, category_id")
      .eq("id", submissionId)
      .single();

    if (!submission)
      return res.status(404).json({ error: "Photo introuvable" });

    // Upsert le vote
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

    // Mettre à jour les compteurs dans eye_prize_result
    const { data: allVotes } = await supabase
      .from("eye_prize_votes")
      .select("submission_id");

    const counts = {};
    (allVotes || []).forEach((v) => {
      counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
    });

    // Supprimer les anciens résultats et recréer
    await supabase
      .from("eye_prize_result")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    for (const [subId, count] of Object.entries(counts)) {
      await supabase.from("eye_prize_result").insert({
        submission_id: subId,
        total_votes: count,
        is_finalized: false,
      });
    }

    await log(req.user.id, "EYE_PRIZE_VOTE", "eye_prize_votes", submissionId);
    res.json({ success: true, message: "Vote enregistré !" });
  } catch (e) {
    console.error("[eye-prize/vote] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ROUTES ADMIN POUR RÉINITIALISATION
// ════════════════════════════════════════════════════════════════

router.post(
  "/eye-prize/reset-all",
  requireAuth,
  requireAdmin,
  async (req, res) => {
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
      await log(req.user.id, "EYE_PRIZE_RESET_ALL", "eye_prize_votes", null);
      res.json({
        success: true,
        message: "✅ Prix de l'œil complètement réinitialisé",
      });
    } catch (e) {
      console.error("[eye-prize/reset-all] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

router.post(
  "/eye-prize/reset-juror/:jurorId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { jurorId } = req.params;

    try {
      const { data: juror } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .eq("id", jurorId)
        .in("role_id", [2, 3])
        .single();

      if (!juror) {
        return res.status(404).json({ error: "Juré non trouvé" });
      }

      await supabase.from("eye_prize_votes").delete().eq("juror_id", jurorId);

      // Mettre à jour les compteurs
      const { data: allVotes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");
      const counts = {};
      (allVotes || []).forEach((v) => {
        counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
      });

      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      for (const [subId, count] of Object.entries(counts)) {
        await supabase.from("eye_prize_result").insert({
          submission_id: subId,
          total_votes: count,
          is_finalized: false,
        });
      }

      await log(
        req.user.id,
        "EYE_PRIZE_RESET_JUROR",
        "eye_prize_votes",
        jurorId,
        {
          jurorName: `${juror.first_name} ${juror.last_name}`,
        },
      );

      res.json({
        success: true,
        message: `✅ Vote de ${juror.first_name} ${juror.last_name} réinitialisé`,
      });
    } catch (e) {
      console.error("[eye-prize/reset-juror] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

router.get(
  "/eye-prize/admin-details",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: jurors } = await supabase
        .from("users")
        .select("id, first_name, last_name, role_id")
        .in("role_id", [2, 3])
        .order("last_name");

      const { data: votes } = await supabase.from("eye_prize_votes").select(`
        id,
        juror_id,
        submission_id,
        voted_at,
        submissions!eye_prize_votes_submission_id_fkey (
          id,
          anonymous_id,
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )
      `);

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

      const jurorVotes = {};
      jurors.forEach((juror) => {
        const vote = votesWithUrls.find((v) => v.juror_id === juror.id);
        jurorVotes[juror.id] = {
          jurorId: juror.id,
          jurorName: `${juror.first_name} ${juror.last_name}`,
          hasVoted: !!vote,
          vote: vote || null,
        };
      });

      const photoVotes = {};
      votesWithUrls.forEach((vote) => {
        const key = vote.submission_id;
        if (!photoVotes[key]) {
          photoVotes[key] = {
            submissionId: key,
            anonymousId: vote.submissions?.anonymous_id,
            photoUrl: vote.submissions?.photoUrl,
            categoryName: vote.submissions?.categories?.name,
            votes: 0,
            jurorIds: [],
          };
        }
        photoVotes[key].votes++;
        photoVotes[key].jurorIds.push(vote.juror_id);
      });

      const { data: finalResult } = await supabase
        .from("eye_prize_result")
        .select("*")
        .eq("is_finalized", true)
        .maybeSingle();

      res.json({
        jurors: Object.values(jurorVotes),
        photoVotes: Object.values(photoVotes).sort((a, b) => b.votes - a.votes),
        finalResult,
        totalJurors: jurors.length,
        totalVotes: votes?.length || 0,
      });
    } catch (e) {
      console.error("[eye-prize/admin-details] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// FINALISATION - ROUTE CORRECTE
// ════════════════════════════════════════════════════════════════

router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      // Récupérer tous les votes
      const { data: votes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");

      if (!votes || votes.length === 0) {
        return res.status(400).json({ error: "Aucun vote n'a été enregistré" });
      }

      // Compter les votes par soumission
      const counts = {};
      votes.forEach((v) => {
        counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
      });

      // Trouver le(s) gagnant(s)
      let maxVotes = 0;
      let winner = null;
      let tiedSubmissions = [];

      for (const [id, count] of Object.entries(counts)) {
        if (count > maxVotes) {
          maxVotes = count;
          winner = id;
          tiedSubmissions = [id];
        } else if (count === maxVotes && count > 0) {
          tiedSubmissions.push(id);
        }
      }

      // Vérifier s'il y a égalité
      if (tiedSubmissions.length > 1) {
        return res.status(409).json({
          error: "Égalité détectée",
          hasTie: true,
          tiedSubmissions: tiedSubmissions,
        });
      }

      if (!winner) {
        return res
          .status(400)
          .json({ error: "Impossible de déterminer le gagnant" });
      }

      // Supprimer l'ancien résultat
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      // Créer le nouveau résultat finalisé
      const { data: result, error } = await supabase
        .from("eye_prize_result")
        .insert({
          submission_id: winner,
          total_votes: counts[winner],
          is_finalized: true,
          finalized_at: new Date().toISOString(),
          finalized_by: req.user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Mettre à jour l'état
      await supabase.from("eye_prize_state").upsert({
        id: 1,
        has_tie: false,
        resolved_at: new Date().toISOString(),
        resolved_by: req.user.id,
        winning_submission_id: winner,
      });

      await log(req.user.id, "EYE_PRIZE_FINALIZED", "eye_prize_result", winner);

      res.json({
        success: true,
        winner: winner,
        totalVotes: counts[winner],
        message: `✅ Prix de l'œil finalisé avec ${counts[winner]} vote(s)`,
      });
    } catch (e) {
      console.error("[eye-prize/finalize] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// RÉSOLUTION D'ÉGALITÉ
// ════════════════════════════════════════════════════════════════

router.post(
  "/eye-prize/resolve-tie",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { winningSubmissionId } = req.body;
    if (!winningSubmissionId)
      return res.status(400).json({ error: "winningSubmissionId requis" });

    try {
      // Vérifier que la photo est bien parmi les ex-aequo
      const { data: votes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");

      const counts = {};
      (votes || []).forEach((v) => {
        counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
      });

      const maxVotes = Math.max(...Object.values(counts));
      const tiedSubmissions = Object.entries(counts)
        .filter(([, c]) => c === maxVotes)
        .map(([id]) => id);

      if (!tiedSubmissions.includes(winningSubmissionId)) {
        return res
          .status(400)
          .json({ error: "Cette photo n'est pas parmi les ex-aequo" });
      }

      // Supprimer l'ancien résultat
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      // Créer le nouveau résultat avec la gagnante choisie
      await supabase.from("eye_prize_result").insert({
        submission_id: winningSubmissionId,
        total_votes: counts[winningSubmissionId],
        is_finalized: true,
        finalized_at: new Date().toISOString(),
        finalized_by: req.user.id,
      });

      // Mettre à jour l'état
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

export default router;
