// backend/utils/audit.js
import supabase from "./supabase.js";

export async function log(userId, action, entity, entityId, details = {}) {
  try {
    await supabase.from("audit_log").insert({
      user_id: userId || null,
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      details,
    });
  } catch (e) {
    // L'audit ne doit jamais faire planter l'app
    console.error("[AUDIT ERROR]", e.message);
  }
}
