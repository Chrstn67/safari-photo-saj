// backend/scripts/init-admin.js
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function initAdmin() {
  console.log("🔧 Initialisation du compte admin...");

  // Vérifier si l'utilisateur existe déjà
  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("id")
    .ilike("first_name", "Christian")
    .ilike("last_name", "HUMBERT")
    .single();

  if (existing) {
    console.log("✅ Le compte admin existe déjà");
    return;
  }

  // Hasher le mot de passe
  const passwordHash = await bcrypt.hash("SafariSAJ", 12);

  // Créer l'admin (role_id = 3 pour admin)
  const { data: user, error } = await supabase
    .from("users")
    .insert({
      first_name: "Christian",
      last_name: "HUMBERT",
      password_hash: passwordHash,
      role_id: 3, // 3 = admin
      is_active: true,
    })
    .select("id, first_name, last_name, role_id")
    .single();

  if (error) {
    console.error("❌ Erreur lors de la création :", error.message);
    return;
  }

  console.log("✅ Admin créé avec succès !");
  console.log(`   ID: ${user.id}`);
  console.log(`   Nom: ${user.first_name} ${user.last_name}`);
  console.log(`   Rôle: Admin (3)`);
  console.log("\n🔐 Vous pouvez maintenant vous connecter avec :");
  console.log(`   Prénom: Christian`);
  console.log(`   Nom: HUMBERT`);
  console.log(`   Mot de passe: SafariSAJ`);
}

initAdmin();
