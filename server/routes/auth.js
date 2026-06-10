// backend/routes/auth.js
// ═══════════════════════════════════════════════════════════════
// FLUX D'AUTHENTIFICATION
//
// INSCRIPTION  (/register)
//   → Ouverte à tous : participants, futurs jurés, admin
//   → Tout le monde s'inscrit avec prénom + nom + mdp
//   → role_id forcé à 1 (participant) par défaut
//   → L'admin élève ensuite les droits depuis le dashboard
//
// CONNEXION (/login)
//   → prénom + nom + mdp → JWT signé avec le vrai rôle BDD
//   → Redirection côté front selon le rôle retourné
//
// RÈGLE D'OR ANONYMAT
//   → Jamais de join photos→users renvoyé à un juré/admin
//   → Le champ author n'est résolu QUE si results.is_published = true
//     ou si c'est une requête admin hors délibération
// ═══════════════════════════════════════════════════════════════

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supabase from "../utils/supabase.js";
import { log } from "../utils/audit.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* ── POST /api/auth/register ────────────────────────────────────
   Inscription unifiée.
   Tout utilisateur (jeune, futur juré, admin secondaire) peut
   créer son compte ici. Le rôle de départ est TOUJOURS participant (1).
   L'admin Christian HUMBERT est le seul créé directement en BDD
   via bootstrap_admin.sql — il se connecte normalement ici.
──────────────────────────────────────────────────────────────── */
router.post("/register", async (req, res) => {
  const { firstName, lastName, password } = req.body;

  if (!firstName?.trim() || !lastName?.trim() || !password) {
    return res
      .status(400)
      .json({ error: "Prénom, nom et mot de passe requis" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Mot de passe : 6 caractères minimum" });
  }

  try {
    // Vérifie doublon (insensible à la casse)
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .ilike("first_name", firstName.trim())
      .ilike("last_name", lastName.trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: "Ce nom est déjà utilisé" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // role_id = 1 (participant) TOUJOURS à l'inscription
    // → l'admin change le rôle ensuite via PATCH /api/admin/users/:id
    const { data: user, error } = await supabase
      .from("users")
      .insert({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        password_hash: passwordHash,
        role_id: 1,
      })
      .select("id, first_name, last_name, role_id")
      .single();

    if (error) throw error;

    const token = signToken(user.id, 1);
    await log(user.id, "REGISTER", "users", user.id, {
      firstName: user.first_name,
    });

    res.status(201).json({
      token,
      user: formatUser(user, "participant"),
    });
  } catch (e) {
    console.error("[REGISTER]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/auth/login ───────────────────────────────────────
   Connexion via prénom + nom + mot de passe.
   Retourne le VRAI rôle stocké en BDD → le front redirige en conséquence.
   Christian HUMBERT (admin) se connecte ici comme tout le monde.
──────────────────────────────────────────────────────────────── */
router.post("/login", async (req, res) => {
  const { firstName, lastName, password } = req.body;
  console.log("[LOGIN DEBUG]", {
    firstName,
    lastName,
    passwordLength: password?.length,
  });
  if (!firstName?.trim() || !lastName?.trim() || !password) {
    return res
      .status(400)
      .json({ error: "Prénom, nom et mot de passe requis" });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, first_name, last_name, password_hash, role_id, is_active, roles(name)",
      )
      .ilike("first_name", firstName.trim())
      .ilike("last_name", lastName.trim())
      .single();

    // Message volontairement identique pour ne pas donner d'indice
    if (error || !user) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }
    if (!user.is_active) {
      return res
        .status(403)
        .json({ error: "Compte désactivé — contactez l'organisateur" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    const roleName = user.roles?.name || "participant";
    const token = signToken(user.id, user.role_id);

    await log(user.id, "LOGIN", "users", user.id, { role: roleName });

    res.json({
      token,
      user: formatUser(user, roleName),
    });
  } catch (e) {
    console.error("[LOGIN]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/auth/me ───────────────────────────────────────── */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/* ── PATCH /api/auth/change-password ───────────────────────── */
router.patch("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Données invalides" });
  }
  try {
    const { data: user } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", req.user.id)
      .single();

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "Mot de passe actuel incorrect" });

    const newHash = await bcrypt.hash(newPassword, 12);
    await supabase
      .from("users")
      .update({ password_hash: newHash })
      .eq("id", req.user.id);
    await log(req.user.id, "CHANGE_PASSWORD", "users", req.user.id);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Helpers ── */
function signToken(userId, roleId) {
  return jwt.sign({ sub: userId, roleId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "12h",
  });
}

function formatUser(user, roleName) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    role: roleName,
    roleId: user.role_id,
  };
}

export default router;
