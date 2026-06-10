// backend/utils/anonymize.js

/**
 * Génère un identifiant anonyme de la forme PHOTO-0042-CAT-Végétation
 * @param {number} counter  — numéro séquentiel global
 * @param {string} catName  — nom lisible de la catégorie
 */
export function generateAnonymousId(counter, catName) {
  const num = String(counter).padStart(4, "0");
  const safe = catName
    .replace(/[^a-zA-ZÀ-ÿ0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `PHOTO-${num}-CAT-${safe}`;
}

/**
 * Calcule l'ordre de passage aléatoire pour une catégorie
 * @param {string[]} submissionIds  — tableau d'UUIDs à mélanger
 * @returns {string[]} tableau mélangé
 */
export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
