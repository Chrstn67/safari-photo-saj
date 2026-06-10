-- ═══════════════════════════════════════════════════════
-- SAFARI PHOTO · BOOTSTRAP ADMIN
-- À exécuter UNE SEULE FOIS dans Supabase SQL Editor
-- après avoir exécuté supabase_schema.sql
-- ═══════════════════════════════════════════════════════

-- Crée le compte administrateur Christian HUMBERT
-- MDP : SafariSAJ (hash bcrypt 12 rounds)
INSERT INTO users (first_name, last_name, password_hash, role_id, is_active)
VALUES (
  'Christian',
  'HUMBERT',
  '$2a$12$UN1bsQn70P7m4rHbzMKIF.kw44ZW1rabIExB2ibRqSfjKS0kOxWym',
  3,       -- role_id 3 = admin
  true
)
ON CONFLICT DO NOTHING;

-- Vérification : doit retourner 1 ligne avec role_id = 3
SELECT id, first_name, last_name, role_id, is_active, created_at
FROM users
WHERE lower(first_name) = 'christian' AND lower(last_name) = 'humbert';
