// backend/scripts/init-diapo.js
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function initDiapoAccount() {
  console.log("🔧 Initialisation du compte DIAPO...");

  // Vérifier si le compte DIAPO existe déjà
  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("id, first_name, last_name, role_id")
    .ilike("first_name", "DIAPO")
    .ilike("last_name", "SAJ")
    .single();

  if (existing) {
    console.log("✅ Le compte DIAPO existe déjà");
    console.log(`   ID: ${existing.id}`);
    console.log(`   Nom: ${existing.first_name} ${existing.last_name}`);
    console.log(
      `   Rôle: ${existing.role_id === 2 ? "Juré" : existing.role_id === 3 ? "Admin" : "Participant"}`,
    );

    // Si le rôle n'est pas juré, le mettre à jour
    if (existing.role_id !== 2) {
      console.log("📝 Mise à jour du rôle vers Juré...");
      const { error: updateError } = await supabase
        .from("users")
        .update({ role_id: 2 })
        .eq("id", existing.id);

      if (updateError) {
        console.error("❌ Erreur mise à jour rôle:", updateError.message);
      } else {
        console.log("✅ Rôle mis à jour vers Juré");
      }
    }
    return;
  }

  // Hasher le mot de passe
  const passwordHash = await bcrypt.hash("DiapoSafari", 12);

  // Créer le compte DIAPO (role_id = 2 pour juré, car il voit les photos)
  const { data: user, error } = await supabase
    .from("users")
    .insert({
      first_name: "DIAPO",
      last_name: "SAJ",
      password_hash: passwordHash,
      role_id: 2, // 2 = juré (pour voir les photos en notation)
      is_active: true,
    })
    .select("id, first_name, last_name, role_id")
    .single();

  if (error) {
    console.error("❌ Erreur lors de la création :", error.message);
    return;
  }

  console.log("✅ Compte DIAPO créé avec succès !");
  console.log(`   ID: ${user.id}`);
  console.log(`   Nom: ${user.first_name} ${user.last_name}`);
  console.log(`   Rôle: Juré (2)`);
  console.log("\n🔐 Vous pouvez maintenant vous connecter avec :");
  console.log(`   Prénom: DIAPO`);
  console.log(`   Nom: SAJ`);
  console.log(`   Mot de passe: DiapoSafari`);
  console.log("\n📺 Ce compte est dédié à l'affichage du diaporama sur écran.");
}

initDiapoAccount();
