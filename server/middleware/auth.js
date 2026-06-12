// backend/middleware/auth.js
import jwt from "jsonwebtoken";
import supabase from "../utils/supabase.js";

async function requireAuth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, role_id, is_active, roles(name)")
      .eq("id", payload.sub)
      .single();

    if (error || !user || !user.is_active) {
      return res
        .status(401)
        .json({ error: "Utilisateur invalide ou désactivé" });
    }
    req.user = {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      roleId: user.role_id,
      role: user.roles?.name || (user.role_id === 4 ? "diapo" : "participant"),
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `Accès interdit. Rôle requis : ${roles.join(", ")}` });
    }
    next();
  };
}

const requireAdmin = requireRole("admin");
const requireJuror = requireRole("juror", "admin");
const requireParticipant = requireRole("participant");
const requireDiapo = requireRole("diapo");

export {
  requireAuth,
  requireRole,
  requireAdmin,
  requireJuror,
  requireParticipant,
  requireDiapo,
};
