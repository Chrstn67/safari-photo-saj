-- ═══════════════════════════════════════════════════════
-- SAFARI PHOTO · SCHÉMA SUPABASE COMPLET
-- ═══════════════════════════════════════════════════════
-- Exécuter dans l'éditeur SQL Supabase dans l'ordre ci-dessous

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ROLES ──────────────────────────────────────────────
CREATE TABLE roles (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE   -- 'participant', 'juror', 'admin'
);
INSERT INTO roles (name) VALUES ('participant'), ('juror'), ('admin');

-- ── USERS ──────────────────────────────────────────────
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id      INT  NOT NULL REFERENCES roles(id) DEFAULT 1,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Index pour connexion rapide
CREATE UNIQUE INDEX users_name_idx ON users (lower(first_name), lower(last_name));

-- ── CATEGORIES ─────────────────────────────────────────
CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO categories (name, description, sort_order) VALUES
  ('🏛️ Ville & Vie Locale',      'Bâtiments, rues, patrimoine urbain, scènes humaines', 1),
  ('🍇 Végétation',              'Vignobles, forêts, saisons, végétaux',                 2),
  ('🦊 Animaux & Insectes',      'Faune sauvage / domestique',                           3),
  ('🌅 Ciel & Jeux de lumière',  'Levers, couchers, nuages',                             4),
  ('💫 Coup de cœur libre',      'Libre expression',                                     5);

-- ── CRITERIA ───────────────────────────────────────────
CREATE TABLE criteria (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  max_points  NUMERIC(4,1) DEFAULT 5,
  weight      NUMERIC(4,2) DEFAULT 1.0,
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0
);
INSERT INTO criteria (name, description, icon, max_points, sort_order) VALUES
  ('Technique',        'Netteté, lumière, exposition, qualité générale', '🔧', 5, 1),
  ('Composition',      'Cadrage, équilibre visuel, mise en valeur du sujet', '📐', 5, 2),
  ('Respect du thème', 'Correspondance de la photo avec la catégorie choisie', '🎯', 5, 3),
  ('Originalité',      'Créativité, émotion suscitée, impact visuel', '✨', 5, 4);

-- ── PHOTOS (banque personnelle) ────────────────────────
CREATE TABLE photos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  original_name TEXT,
  mime_type     TEXT,
  size_bytes    INT,
  storage_path  TEXT NOT NULL,   -- chemin dans Supabase Storage
  is_submitted  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX photos_user_idx ON photos(user_id);

-- ── SUBMISSIONS ────────────────────────────────────────
CREATE TABLE submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  photo_id      UUID NOT NULL REFERENCES photos(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  category_id   INT  NOT NULL REFERENCES categories(id),
  anonymous_id  TEXT NOT NULL UNIQUE,   -- ex: PHOTO-0001-CAT-3
  display_order INT,                    -- position aveugle dans la catégorie
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_id)          -- 1 photo par catégorie par participant
);
CREATE INDEX submissions_cat_idx ON submissions(category_id);

-- ── DELIBERATION SESSIONS ──────────────────────────────
CREATE TABLE deliberation_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id         INT NOT NULL REFERENCES categories(id),
  current_photo_id    UUID REFERENCES submissions(id),
  status              TEXT DEFAULT 'pending',  -- pending | open | closed | completed
  opened_at           TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX delib_cat_unique ON deliberation_sessions(category_id);

-- ── SCORES ─────────────────────────────────────────────
CREATE TABLE scores (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id  UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  juror_id       UUID NOT NULL REFERENCES users(id),
  criterion_id   INT  NOT NULL REFERENCES criteria(id),
  value          NUMERIC(4,1) DEFAULT 0 CHECK (value >= 0),
  is_validated   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(submission_id, juror_id, criterion_id)
);
CREATE INDEX scores_submission_idx ON scores(submission_id);
CREATE INDEX scores_juror_idx ON scores(juror_id);

-- ── FAVORITES (coups de cœur) ──────────────────────────
CREATE TABLE favorites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  juror_id      UUID NOT NULL REFERENCES users(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  category_id   INT  NOT NULL REFERENCES categories(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(juror_id, category_id)   -- 1 seul coup de cœur par juré par catégorie
);

-- ── RESULTS ────────────────────────────────────────────
CREATE TABLE results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id     INT  REFERENCES categories(id),
  submission_id   UUID REFERENCES submissions(id),
  rank            INT,
  average_score   NUMERIC(5,2),
  total_score     NUMERIC(7,2),
  is_published    BOOLEAN DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  published_by    UUID REFERENCES users(id),
  computed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── JURY VALIDATION (suivi par photo/juré) ─────────────
CREATE TABLE jury_validations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  juror_id      UUID NOT NULL REFERENCES users(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  validated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(juror_id, submission_id)
);

-- ── AUDIT LOG ─────────────────────────────────────────
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── NOTES / COMMENTAIRES ──────────────────────────────
CREATE TABLE notes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  juror_id      UUID NOT NULL REFERENCES users(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  content       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(juror_id, submission_id)
);

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════
-- NB : L'API REST Node.js utilise la clé SERVICE_ROLE
-- qui bypass RLS. Ces policies protègent l'accès direct.

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE jury_validations    ENABLE ROW LEVEL SECURITY;

-- Seul le service role (backend) a accès complet
-- (pas de client Supabase direct côté front — tout passe par l'API Node)

-- ═══════════════════════════════════════════════════════
-- REALTIME : activer sur les tables nécessaires
-- ═══════════════════════════════════════════════════════
-- Dans le dashboard Supabase > Database > Replication,
-- activer pour : deliberation_sessions, jury_validations, scores, results

-- ═══════════════════════════════════════════════════════
-- STORAGE : créer le bucket 'photos'
-- ═══════════════════════════════════════════════════════
-- Dashboard > Storage > New Bucket > "photos" > Private
