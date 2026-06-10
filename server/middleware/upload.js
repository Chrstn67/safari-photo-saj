// backend/middleware/upload.js
import multer from "multer";
import sharp from "sharp";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import supabase from "../utils/supabase.js";

const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10);

/* ── Multer : stockage en mémoire (buffer), pas sur le disque) ── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = /jpeg|jpg|png|webp|heic|tiff|gif|bmp|raw/i;
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (allowed.test(file.mimetype) || allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Format non supporté : ${file.mimetype}`));
    }
  },
});

/**
 * Après l'upload multer :
 * - Supprime les métadonnées EXIF via sharp (withMetadata(false))
 * - Convertit en JPEG pour la cohérence
 * - Upload dans Supabase Storage bucket "photos"
 * - Retourne { storagePath, publicUrl, sizeBytes, mimeType }
 */
async function processAndStore(buffer, originalName, userId) {
  // sharp strip EXIF + convert to jpeg
  let processedBuffer;
  try {
    processedBuffer = await sharp(buffer)
      .rotate() // auto-rotate EXIF orientation avant de supprimer
      .withMetadata(false) // supprime TOUTES les métadonnées EXIF
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    // Si sharp ne peut pas traiter (RAW très exotique), envoyer le buffer brut
    processedBuffer = buffer;
  }

  const filename = `${userId}/${uuidv4()}.jpg`;
  const { error } = await supabase.storage
    .from("photos")
    .upload(filename, processedBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) throw new Error(`Upload Storage échoué : ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from("photos").getPublicUrl(filename);

  return {
    storagePath: filename,
    publicUrl,
    sizeBytes: processedBuffer.length,
    mimeType: "image/jpeg",
  };
}

/* ── URL signée (accès privé aux soumissions) ── */
async function getSignedUrl(storagePath, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from("photos")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export { upload, processAndStore, getSignedUrl };
