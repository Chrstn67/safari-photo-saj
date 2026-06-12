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

    // COUPS DE CŒUR
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

    // PRIX DE L'ŒIL — lecture du gagnant choisi par l'admin
    const { data: eyePrizeWinner } = await supabase
      .from("eye_prize_selections")
      .select(
        `id, selected_at,
        submissions!eye_prize_selections_submission_id_fkey (
          id, anonymous_id,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )`,
      )
      .maybeSingle();

    let eyePrizeWithUrl = null;
    if (eyePrizeWinner?.submissions?.photos?.storage_path) {
      try {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(
            eyePrizeWinner.submissions.photos.storage_path,
            3600,
          );
        eyePrizeWithUrl = {
          ...eyePrizeWinner,
          submissions: {
            ...eyePrizeWinner.submissions,
            photoUrl: signed?.signedUrl,
          },
        };
      } catch (err) {}
    } else if (eyePrizeWinner) {
      eyePrizeWithUrl = eyePrizeWinner;
    }

    res.json({
      byCategory: resultsWithUrls || [],
      favoriteCounts: favoriteCounts,
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
// PRIX DE L'ŒIL — Sélection directe par l'admin
// ════════════════════════════════════════════════════════════════

// GET /api/results/eye-prize — lire le gagnant actuel
router.get("/eye-prize", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from("eye_prize_selections")
      .select(
        `id, selected_at,
        submissions!eye_prize_selections_submission_id_fkey (
          id, anonymous_id,
          users!submissions_user_id_fkey (first_name, last_name),
          categories!submissions_category_id_fkey (name),
          photos!submissions_photo_id_fkey (storage_path)
        )`,
      )
      .maybeSingle();

    if (!data) return res.json({ winner: null });

    let photoUrl = null;
    const storagePath = data.submissions?.photos?.storage_path;
    if (storagePath) {
      try {
        const { data: signed } = await supabase.storage
          .from("photos")
          .createSignedUrl(storagePath, 3600);
        photoUrl = signed?.signedUrl;
      } catch (err) {}
    }

    res.json({
      winner: {
        ...data,
        submissions: { ...data.submissions, photoUrl },
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/results/eye-prize/submissions — toutes les soumissions pour le sélecteur admin
router.get(
  "/eye-prize/submissions",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: submissions } = await supabase
        .from("submissions")
        .select(
          `id, anonymous_id,
        categories!submissions_category_id_fkey (name),
        photos!submissions_photo_id_fkey (storage_path),
        users!submissions_user_id_fkey (first_name, last_name)`,
        )
        .order("anonymous_id");

      const withUrls = await Promise.all(
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
            photographerName: `${sub.users?.first_name} ${sub.users?.last_name}`,
            photoUrl,
          };
        }),
      );

      res.json(withUrls);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

// POST /api/results/eye-prize/select — choisir le gagnant (remplace toute l'ancienne logique de vote)
router.post(
  "/eye-prize/select",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { submissionId } = req.body;
    if (!submissionId)
      return res.status(400).json({ error: "submissionId requis" });

    try {
      const { data: submission } = await supabase
        .from("submissions")
        .select("id")
        .eq("id", submissionId)
        .single();

      if (!submission)
        return res.status(404).json({ error: "Soumission introuvable" });

      // Une seule ligne dans la table — on vide et réinsère
      await supabase
        .from("eye_prize_selections")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      const { data: selection, error } = await supabase
        .from("eye_prize_selections")
        .insert({
          submission_id: submissionId,
          selected_by: req.user.id,
          selected_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      await log(
        req.user.id,
        "EYE_PRIZE_SELECTED",
        "eye_prize_selections",
        submissionId,
      );
      res.json({ success: true, selection });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

// DELETE /api/results/eye-prize — effacer la sélection
router.delete("/eye-prize", requireAuth, requireAdmin, async (req, res) => {
  try {
    await supabase
      .from("eye_prize_selections")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await log(req.user.id, "EYE_PRIZE_CLEARED", "eye_prize_selections", null);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
