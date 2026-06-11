// backend/routes/results.js - Version CORRIGÉE avec anonymat strict
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
// GET /api/results/palmares - AVEC ANONYMAT STRICT
// Les noms des participants ne sont visibles que si les résultats sont publiés
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

    // Droit de voir les noms des photographes
    const canSeePhotographerNames =
      isAdmin || (isJuror && jurorsCanView) || (isParticipant && isPublished);

    let canViewResults = false;
    if (isAdmin) canViewResults = true;
    else if (isJuror) canViewResults = jurorsCanView;
    else if (isParticipant) canViewResults = isPublished;

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

        // ANONYMISATION : ne montrer le nom que si autorisé
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

    // Classement général (toujours anonyme tant que non publié)
    const userScores = {};
    resultsWithUrls.forEach((r) => {
      const author = r.author;
      if (!author) {
        // Si anonyme, utiliser anonymous_id
        const key = r.submissions?.anonymous_id || `Photo ${r.submissions?.id}`;
        if (!userScores[key])
          userScores[key] = { name: key, total: 0, finalists: 0 };
        userScores[key].total += r.average_score || 0;
        if (r.rank === 1) userScores[key].finalists++;
      } else {
        if (!userScores[author])
          userScores[author] = { name: author, total: 0, finalists: 0 };
        userScores[author].total += r.average_score || 0;
        if (r.rank === 1) userScores[author].finalists++;
      }
    });
    const generalRanking = Object.values(userScores).sort(
      (a, b) => b.total - a.total,
    );
    const bestPhotographer = canSeePhotographerNames
      ? generalRanking[0] || null
      : null;

    // ════════════════════════════════════════════════════════════════
    // COUPS DE CŒUR - Pour ADMIN seulement
    // ════════════════════════════════════════════════════════════════
    let favoriteCounts = [];
    let favoritesWithJurors = [];

    if (isAdmin) {
      // Pour l'admin : voir tous les coups de cœur avec les noms des jurés et des photographes
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

      favoritesWithJurors = await Promise.all(
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

      // Compter par photo
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
      // Pour les jurés et participants : version anonyme (juste les photos et le nombre)
      const { data: favorites } = await supabase.from("favorites").select(`
          id, submission_id,
          submissions!favorites_submission_id_fkey (
            id, anonymous_id,
            categories!submissions_category_id_fkey (name),
            photos!submissions_photo_id_fkey (storage_path)
          )
        `);

      favoritesWithJurors = await Promise.all(
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
      favoritesWithJurors.forEach((fav) => {
        const key = fav.submissionId;
        if (!countMap.has(key)) {
          countMap.set(key, {
            submissionId: fav.submissionId,
            anonymousId: fav.anonymousId,
            photoUrl: fav.photoUrl,
            categoryName: fav.categoryName,
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

    // Toutes les soumissions pour le vote
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
        // Pour les votes, on ne montre le nom que si autorisé
        const showName = canSeePhotographerNames;
        return {
          id: sub.id,
          anonymous_id: sub.anonymous_id,
          categoryName: sub.categories?.name,
          photoUrl: photoUrl,
          author:
            showName && sub.users
              ? `${sub.users.first_name} ${sub.users.last_name}`
              : null,
        };
      }),
    );

    // Récupérer les votes
    const { data: eyePrizeVotes } = await supabase
      .from("eye_prize_votes")
      .select("id, juror_id, submission_id, voted_at");

    // Compter les votes
    const voteCountsMap = new Map();
    (eyePrizeVotes || []).forEach((vote) => {
      const sub = submissionsWithUrls.find((s) => s.id === vote.submission_id);
      const key = vote.submission_id;
      if (!voteCountsMap.has(key) && sub) {
        voteCountsMap.set(key, {
          submissionId: key,
          anonymousId: sub.anonymous_id,
          author: sub.author,
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

    // Résultat finalisé
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
      } catch (err) {
        finalResultWithUrl = finalResult;
      }
    }

    // Mon vote
    const myVote = eyePrizeVotes?.find((v) => v.juror_id === req.user.id);
    const myVoteDetails = myVote
      ? submissionsWithUrls.find((s) => s.id === myVote.submission_id)
      : null;

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: favoriteCounts,
      favoritesWithJurors: isAdmin ? favoritesWithJurors : undefined,
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
      jurorsCanView,
      isPublished,
    });
  } catch (e) {
    console.error("[palmares] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/results/select-eye-prize - Route manquante !
// ════════════════════════════════════════════════════════════════
router.post(
  "/select-eye-prize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;
    if (!submissionId) {
      return res.status(400).json({ error: "submissionId requis" });
    }

    try {
      // Vérifier que la soumission existe
      const { data: submission } = await supabase
        .from("submissions")
        .select("id, anonymous_id")
        .eq("id", submissionId)
        .single();

      if (!submission) {
        return res.status(404).json({ error: "Soumission introuvable" });
      }

      // Supprimer l'ancien résultat
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      // Créer le nouveau résultat
      const { data: result, error } = await supabase
        .from("eye_prize_result")
        .insert({
          submission_id: submissionId,
          total_votes: 0,
          is_finalized: true,
          finalized_at: new Date().toISOString(),
          finalized_by: req.user.id,
        })
        .select()
        .single();

      if (error) throw error;

      await log(
        req.user.id,
        "EYE_PRIZE_SELECTED",
        "eye_prize_result",
        submissionId,
      );
      res.json({
        success: true,
        message: "Prix de l'œil attribué avec succès !",
      });
    } catch (e) {
      console.error("[select-eye-prize] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// PRIX DE L'ŒIL - AUTRES ROUTES
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
    res.status(500).json({ error: e.message });
  }
});

router.post(
  "/eye-prize/resolve-tie",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { winningSubmissionId } = req.body;
    if (!winningSubmissionId)
      return res.status(400).json({ error: "winningSubmissionId requis" });

    try {
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

      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("eye_prize_result").insert({
        submission_id: winningSubmissionId,
        total_votes: counts[winningSubmissionId],
        is_finalized: true,
        finalized_at: new Date().toISOString(),
        finalized_by: req.user.id,
      });

      res.json({ success: true, message: "Prix de l'œil finalisé !" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;

    try {
      const { data: votes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");
      const counts = {};
      (votes || []).forEach((v) => {
        counts[v.submission_id] = (counts[v.submission_id] || 0) + 1;
      });

      let winner = submissionId;
      if (!winner) {
        let maxVotes = 0;
        for (const [id, count] of Object.entries(counts)) {
          if (count > maxVotes) {
            maxVotes = count;
            winner = id;
          }
        }
        if (!winner)
          return res.status(400).json({ error: "Aucun vote enregistré" });
      }

      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("eye_prize_result").insert({
        submission_id: winner,
        total_votes: counts[winner] || 0,
        is_finalized: true,
        finalized_at: new Date().toISOString(),
        finalized_by: req.user.id,
      });

      res.json({ success: true, message: "Prix de l'œil finalisé !" });
    } catch (e) {
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
    res.status(500).json({ error: e.message });
  }
});

export default router;
