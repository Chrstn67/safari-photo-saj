// backend/routes/scores.js
import express from "express";
import supabase from "../utils/supabase.js";
import { requireAuth, requireJuror } from "../middleware/auth.js";
import { log } from "../utils/audit.js";

const router = express.Router();

/* ── GET /api/scores/:submissionId  — notes du juré courant sur cette photo ── */
router.get("/:submissionId", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.params;

  // L'admin et les jurés ne voient que leurs propres notes pendant la délibération
  const { data, error } = await supabase
    .from("scores")
    .select("*, criteria(id, name, icon, max_points)")
    .eq("submission_id", submissionId)
    .eq("juror_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ── GET /api/scores/:submissionId/all  — toutes les notes (après validation complète) ── */
router.get(
  "/:submissionId/all",
  requireAuth,
  requireJuror,
  async (req, res) => {
    const { submissionId } = req.params;

    // Vérifier que toutes les notes sont validées pour cette photo
    const { data: scores } = await supabase
      .from("scores")
      .select("is_validated")
      .eq("submission_id", submissionId);

    const allValidated =
      scores?.length > 0 && scores.every((s) => s.is_validated);
    if (!allValidated && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Notes visibles uniquement après validation complète" });
    }

    const { data, error } = await supabase
      .from("scores")
      .select(
        "*, criteria(id, name, icon), users!juror_id(first_name, last_name)",
      )
      .eq("submission_id", submissionId);

    if (error) return res.status(500).json({ error: error.message });

    // ANONYMISATION : remplace les noms par "Juré X" si pas admin
    const sanitized = data.map((s, i) => ({
      ...s,
      jurorName:
        req.user.role === "admin"
          ? `${s.users.first_name} ${s.users.last_name}`
          : `Juré ${i + 1}`,
      users: undefined,
    }));

    res.json(sanitized);
  },
);

/* ── PUT /api/scores  — saisir/modifier une note (avant validation) ── */
router.put("/", requireAuth, requireJuror, async (req, res) => {
  const { submissionId, criterionId, value } = req.body;

  if (
    submissionId === undefined ||
    criterionId === undefined ||
    value === undefined
  ) {
    return res
      .status(400)
      .json({ error: "submissionId, criterionId, value requis" });
  }
  if (value < 0 || value > 20) {
    return res.status(400).json({ error: "Note entre 0 et 20" });
  }

  // Vérifie que le juré n'a pas déjà validé cette soumission
  const { data: existingValidation } = await supabase
    .from("jury_validations")
    .select("id")
    .eq("juror_id", req.user.id)
    .eq("submission_id", submissionId)
    .single();

  if (existingValidation) {
    return res
      .status(403)
      .json({ error: "Note verrouillée : vous avez déjà validé cette photo" });
  }

  const { data, error } = await supabase
    .from("scores")
    .upsert(
      {
        submission_id: submissionId,
        juror_id: req.user.id,
        criterion_id: criterionId,
        value: parseFloat(value),
        is_validated: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "submission_id,juror_id,criterion_id" },
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ── POST /api/scores/validate  — valider toutes ses notes pour une photo ── */
router.post("/validate", requireAuth, requireJuror, async (req, res) => {
  const { submissionId } = req.body;
  if (!submissionId)
    return res.status(400).json({ error: "submissionId requis" });

  try {
    // Marquer toutes les notes du juré comme validées
    await supabase
      .from("scores")
      .update({ is_validated: true })
      .eq("submission_id", submissionId)
      .eq("juror_id", req.user.id);

    // Enregistrer la validation
    const { error: valErr } = await supabase.from("jury_validations").upsert(
      {
        juror_id: req.user.id,
        submission_id: submissionId,
        validated_at: new Date().toISOString(),
      },
      { onConflict: "juror_id,submission_id" },
    );

    if (valErr) throw valErr;

    await log(req.user.id, "SCORE_VALIDATE", "scores", submissionId);

    // Vérifier si tous les jurés ont validé → déclencher passage automatique
    const { data: allJurors } = await supabase
      .from("users")
      .select("id")
      .in("role_id", [2, 3]);

    const { data: validations } = await supabase
      .from("jury_validations")
      .select("juror_id")
      .eq("submission_id", submissionId);

    const validatedIds = (validations || []).map((v) => v.juror_id);
    const allValidated = (allJurors || []).every((j) =>
      validatedIds.includes(j.id),
    );

    res.json({ success: true, allValidated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/scores/favorite  — coup de cœur ── */
router.post("/favorite", requireAuth, requireJuror, async (req, res) => {
  const { submissionId, categoryId } = req.body;
  if (!submissionId || !categoryId) {
    return res.status(400).json({ error: "submissionId et categoryId requis" });
  }

  try {
    // Un seul coup de cœur par catégorie par juré
    const { data: existing } = await supabase
      .from("favorites")
      .select("id, submission_id")
      .eq("juror_id", req.user.id)
      .eq("category_id", categoryId)
      .single();

    if (existing) {
      if (existing.submission_id === submissionId) {
        // Retirer si c'est la même photo
        await supabase.from("favorites").delete().eq("id", existing.id);
        return res.json({ removed: true });
      }
      // Remplacer
      await supabase
        .from("favorites")
        .update({ submission_id: submissionId })
        .eq("id", existing.id);
      return res.json({ replaced: true });
    }

    const { error } = await supabase.from("favorites").insert({
      juror_id: req.user.id,
      submission_id: submissionId,
      category_id: categoryId,
    });
    if (error) throw error;

    res.json({ added: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/scores/summary/:categoryId  — résumé par catégorie (admin ou post-publication) ── */
router.get("/summary/:categoryId", requireAuth, async (req, res) => {
  const { categoryId } = req.params;

  // Récupère toutes les soumissions + leurs scores
  const { data: subs } = await supabase
    .from("submissions")
    .select(
      `
      id, anonymous_id, display_order,
      scores(value, juror_id, is_validated, criteria(name, icon))
    `,
    )
    .eq("category_id", categoryId)
    .order("display_order");

  if (!subs) return res.json([]);

  const result = subs.map((sub) => {
    const totalByJuror = {};
    sub.scores.forEach((s) => {
      if (!totalByJuror[s.juror_id]) totalByJuror[s.juror_id] = 0;
      totalByJuror[s.juror_id] += s.value;
    });
    const jurorScores = Object.values(totalByJuror);
    const avg = jurorScores.length
      ? jurorScores.reduce((a, b) => a + b, 0) / jurorScores.length
      : 0;

    return {
      submissionId: sub.id,
      anonymousId: sub.anonymous_id,
      displayOrder: sub.display_order,
      average: Math.round(avg * 100) / 100,
      totalScores: jurorScores.length,
      details: req.user.role === "admin" ? sub.scores : undefined,
    };
  });

  res.json(result);
});

export default router;
