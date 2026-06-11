// backend/routes/results.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireAdmin, requireJuror } from "../middleware/auth.js";
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

/* ════════════════════════════════════════════════════════════════
   PRIX DE L'ŒIL - SYSTÈME DE VOTE
════════════════════════════════════════════════════════════════ */

/* ── GET /api/results/eye-prize/votes ── Récupère tous les votes ── */
router.get("/eye-prize/votes", requireAuth, requireJuror, async (req, res) => {
  try {
    // Récupérer tous les votes avec les infos des photos
    const { data: votes, error } = await supabase.from("eye_prize_votes")
      .select(`
        id,
        juror_id,
        submission_id,
        voted_at,
        submissions!submission_id(
          id,
          anonymous_id,
          users(first_name, last_name),
          categories(name),
          photos(storage_path)
        ),
        users!juror_id(first_name, last_name)
      `);

    if (error) throw error;

    // Ajouter les URLs signées
    const votesWithUrls = await Promise.all(
      (votes || []).map(async (vote) => {
        let photoUrl = null;
        if (vote.submissions?.photos?.storage_path) {
          try {
            const { data: signed } = await supabase.storage
              .from("photos")
              .createSignedUrl(vote.submissions.photos.storage_path, 3600);
            photoUrl = signed?.signedUrl;
          } catch (err) {
            console.error("Erreur URL signée:", err);
          }
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
    const voteCounts = {};
    (votesWithUrls || []).forEach((vote) => {
      const key = vote.submission_id;
      if (!voteCounts[key]) {
        voteCounts[key] = {
          submissionId: vote.submission_id,
          anonymousId: vote.submissions?.anonymous_id,
          categoryName: vote.submissions?.categories?.name,
          author: vote.submissions?.users
            ? `${vote.submissions.users.first_name} ${vote.submissions.users.last_name}`
            : null,
          photoUrl: vote.submissions?.photoUrl,
          votes: 0,
          voters: [],
        };
      }
      voteCounts[key].votes++;
      voteCounts[key].voters.push({
        jurorId: vote.juror_id,
        jurorName: vote.users?.first_name
          ? `${vote.users.first_name} ${vote.users.last_name}`
          : "Juré",
        votedAt: vote.voted_at,
      });
    });

    // Récupérer le vote de l'utilisateur courant
    const myVote = votesWithUrls?.find((v) => v.juror_id === req.user.id);

    // Récupérer le résultat finalisé
    const { data: finalResult } = await supabase
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

    // Récupérer tous les jurés pour compter le total
    const { data: allJurors } = await supabase
      .from("users")
      .select("id")
      .in("role_id", [2, 3]);

    res.json({
      votes: votesWithUrls,
      voteCounts: Object.values(voteCounts),
      myVote: myVote || null,
      finalResult: finalResultWithUrl,
      totalJurors: allJurors?.length || 0,
    });
  } catch (e) {
    console.error("[EYE_PRIZE_VOTES] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/results/eye-prize/vote ── Voter pour une photo ── */
router.post("/eye-prize/vote", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;

  if (!submissionId) {
    return res.status(400).json({ error: "submissionId requis" });
  }

  try {
    // Vérifier que la soumission existe
    const { data: submission, error: subError } = await supabase
      .from("submissions")
      .select("id, anonymous_id, category_id")
      .eq("id", submissionId)
      .single();

    if (subError || !submission) {
      return res.status(404).json({ error: "Photo introuvable" });
    }

    // Vérifier si l'utilisateur a déjà voté
    const { data: existingVote } = await supabase
      .from("eye_prize_votes")
      .select("id")
      .eq("juror_id", req.user.id)
      .maybeSingle();

    if (existingVote) {
      // Remplacer le vote existant
      const { error: updateError } = await supabase
        .from("eye_prize_votes")
        .update({
          submission_id: submissionId,
          category_id: submission.category_id,
          voted_at: new Date().toISOString(),
        })
        .eq("id", existingVote.id);

      if (updateError) throw updateError;
    } else {
      // Créer un nouveau vote
      const { error: insertError } = await supabase
        .from("eye_prize_votes")
        .insert({
          juror_id: req.user.id,
          submission_id: submissionId,
          category_id: submission.category_id,
          voted_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;
    }

    await log(req.user.id, "EYE_PRIZE_VOTE", "submissions", submissionId, {
      anonymousId: submission.anonymous_id,
    });

    res.json({
      success: true,
      message: "Vote enregistré !",
      submissionId,
    });
  } catch (e) {
    console.error("[EYE_PRIZE_VOTE] Erreur:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/results/eye-prize/finalize ── Finaliser le prix (admin seulement) ── */
router.post(
  "/eye-prize/finalize",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId requis" });
    }

    try {
      // Récupérer tous les votes
      const { data: votes } = await supabase
        .from("eye_prize_votes")
        .select("submission_id");

      // Compter les votes
      const voteCounts = {};
      (votes || []).forEach((vote) => {
        voteCounts[vote.submission_id] =
          (voteCounts[vote.submission_id] || 0) + 1;
      });

      // Trouver le maximum de votes
      let maxVotes = 0;
      let winners = [];
      for (const [subId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
          maxVotes = count;
          winners = [subId];
        } else if (count === maxVotes) {
          winners.push(subId);
        }
      }

      let finalSubmissionId = submissionId;

      // Si plusieurs gagnants et qu'un ID est fourni, l'utiliser pour départager
      if (winners.length > 1) {
        if (!submissionId || !winners.includes(submissionId)) {
          return res.status(400).json({
            error:
              "Égalité détectée. Veuillez sélectionner une photo parmi les ex-aequo.",
            tiedSubmissions: winners,
          });
        }
        finalSubmissionId = submissionId;
      } else if (winners.length === 1) {
        finalSubmissionId = winners[0];
      } else {
        return res.status(400).json({ error: "Aucun vote enregistré" });
      }

      // Vérifier que la soumission existe
      const { data: submission, error: subError } = await supabase
        .from("submissions")
        .select("id, anonymous_id")
        .eq("id", finalSubmissionId)
        .single();

      if (subError || !submission) {
        return res.status(404).json({ error: "Photo introuvable" });
      }

      // Supprimer l'ancien résultat
      await supabase
        .from("eye_prize_result")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      // Insérer le nouveau résultat
      const { data: result, error } = await supabase
        .from("eye_prize_result")
        .insert({
          submission_id: finalSubmissionId,
          total_votes: maxVotes,
          is_finalized: true,
          finalized_at: new Date().toISOString(),
          finalized_by: req.user.id,
        })
        .select()
        .single();

      if (error) throw error;

      await log(
        req.user.id,
        "EYE_PRIZE_FINALIZED",
        "eye_prize_result",
        result.id,
        {
          submissionId: finalSubmissionId,
          totalVotes: maxVotes,
          anonymousId: submission.anonymous_id,
        },
      );

      res.json({
        success: true,
        message: "Prix de l'œil finalisé !",
        winner: {
          submissionId: finalSubmissionId,
          votes: maxVotes,
          anonymousId: submission.anonymous_id,
        },
      });
    } catch (e) {
      console.error("[EYE_PRIZE_FINALIZE] Erreur:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

/* ── POST /api/results/eye-prize/reset ── Réinitialiser les votes (admin seulement) ── */
router.post("/eye-prize/reset", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Supprimer tous les votes
    const { error: votesError } = await supabase
      .from("eye_prize_votes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (votesError) throw votesError;

    // Supprimer le résultat finalisé
    const { error: resultError } = await supabase
      .from("eye_prize_result")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (resultError) throw resultError;

    await log(req.user.id, "EYE_PRIZE_RESET", "eye_prize_votes", null);
    res.json({ success: true, message: "Votes réinitialisés" });
  } catch (e) {
    console.error("[EYE_PRIZE_RESET] Erreur:", e);
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

  // Compter les coups de cœur par photo
  const favoriteCounts = {};
  (favorites || []).forEach((fav) => {
    const submission = fav.submissions;
    if (!submission) return;

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

  // Photo avec le plus de coups de cœur
  let topFavorite = null;
  let maxFavs = 0;
  Object.values(favoriteCounts).forEach((fav) => {
    if (fav.count > maxFavs) {
      maxFavs = fav.count;
      topFavorite = fav;
    }
  });

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

  // Ajouter les URLs signées pour les photos
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

  // 5. Récupérer le résultat final du Prix de l'œil
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

  // Ajouter l'URL signée pour le prix de l'œil
  let eyePrizeWithUrl = null;
  if (eyePrizeResult?.submissions?.photos?.storage_path) {
    try {
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
    } catch (err) {
      eyePrizeWithUrl = eyePrizeResult;
    }
  } else {
    eyePrizeWithUrl = eyePrizeResult;
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

export default router;
