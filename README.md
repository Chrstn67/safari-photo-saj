# 📸 Safari Photo — Application de Concours Photo

## Architecture

```
safari-photo/
├── supabase_schema.sql       ← Schéma BDD complet (à exécuter en premier)
├── backend/                  ← API REST Node.js/Express
│   ├── server.js
│   ├── .env.example          ← Copier en .env et remplir
│   ├── routes/
│   │   ├── auth.js           ← Login / Register
│   │   ├── photos.js         ← Upload, banque, soumission
│   │   ├── categories.js     ← Catégories + diaporama
│   │   ├── deliberations.js  ← Sessions, passage, forçage
│   │   ├── scores.js         ← Notes, validation, coup de cœur
│   │   ├── results.js        ← Calcul, publication, palmarès
│   │   └── admin.js          ← CRUD users/cats/critères + audit
│   ├── middleware/
│   │   ├── auth.js           ← JWT + guards de rôle
│   │   └── upload.js         ← Multer + Sharp (strip EXIF)
│   └── utils/
│       ├── supabase.js       ← Client service_role
│       ├── anonymize.js      ← IDs anonymes + shuffle
│       └── audit.js          ← Journal des actions
└── frontend/                 ← React + Vite
    ├── src/
    │   ├── App.jsx            ← Router + ProtectedRoutes
    │   ├── main.jsx
    │   ├── pages/
    │   │   ├── LoginPage.jsx
    │   │   ├── RegisterPage.jsx
    │   │   ├── ParticipantPage.jsx  ← Banque + soumission + résultats
    │   │   ├── JuryPage.jsx         ← Notation + validation + diaporama
    │   │   └── AdminPage.jsx        ← Dashboard complet
    │   ├── components/
    │   │   └── TopBar.jsx
    │   ├── hooks/
    │   │   └── useAuth.jsx    ← AuthContext + login/register/logout
    │   ├── utils/
    │   │   ├── api.js         ← Fetch wrapper avec JWT
    │   │   └── realtime.js    ← Supabase Realtime subscribe()
    │   └── styles/
    │       └── global.css     ← Design system complet (CSS Nested)
    └── index.html
```

---

## 1. Supabase — configuration

### 1.1 Base de données

Dans le **SQL Editor** de Supabase, exécuter `supabase_schema.sql` en entier.

### 1.2 Storage

- Dashboard → **Storage** → **New Bucket**
- Nom : `photos`
- Accès : **Private** (les URLs sont signées via le backend)

### 1.3 Realtime

- Dashboard → **Database** → **Replication**
- Activer pour les tables :
  - `deliberation_sessions`
  - `jury_validations`
  - `scores`
  - `results`

---

## 2. Backend

```bash
cd backend
cp .env.example .env
# Remplir SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET

npm install
npm run dev   # nodemon — port 4000
```

### Variables d'environnement backend

| Variable               | Description                              |
| ---------------------- | ---------------------------------------- |
| `SUPABASE_URL`         | URL de votre projet Supabase             |
| `SUPABASE_SERVICE_KEY` | Clé `service_role` (Settings → API)      |
| `JWT_SECRET`           | Chaîne aléatoire longue (32+ caractères) |
| `JWT_EXPIRES_IN`       | Durée du token (défaut : `12h`)          |
| `PORT`                 | Port serveur (défaut : `4000`)           |
| `FRONTEND_URL`         | URL du frontend pour CORS                |
| `MAX_FILE_SIZE_MB`     | Taille max upload (défaut : `50`)        |

---

## 3. Frontend

```bash
cd frontend
cp .env.example .env
# Remplir VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

npm install
npm run dev   # Vite — port 5173
```

### Variables d'environnement frontend

| Variable                 | Description                              |
| ------------------------ | ---------------------------------------- |
| `VITE_API_URL`           | URL du backend (`http://localhost:4000`) |
| `VITE_SUPABASE_URL`      | URL Supabase (même que backend)          |
| `VITE_SUPABASE_ANON_KEY` | Clé `anon` publique (Settings → API)     |

---

## 4. Créer le premier admin

Comme l'inscription publique est réservée aux participants,
le premier administrateur doit être créé via l'API REST directement :

```bash
# Après démarrage du backend :
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Admin","lastName":"Safari","password":"motdepasse"}'

# Puis dans Supabase SQL Editor, promouvoir en admin :
UPDATE users SET role_id = 3
WHERE first_name = 'Admin' AND last_name = 'Safari';
```

Ensuite, l'admin peut créer des jurés via le dashboard `/admin` → Utilisateurs → Créer.

---

## 5. Flux complet du concours

```
1. Admin crée les jurés via le dashboard
2. Participants s'inscrivent sur /register
3. Participants uploadent leurs photos (banque personnelle)
4. Participants soumettent 1 photo par catégorie
5. Admin ouvre une délibération (onglet Délibérations)
6. Jurés se connectent sur /jury et notent chaque photo
7. Passage automatique quand tous ont validé (ou admin force)
8. En fin de catégorie, chaque juré désigne son coup de cœur
9. Admin calcule les résultats (onglet Résultats → Calculer)
10. Admin publie les résultats → visibles par tous
```

---

## 6. Mode Diaporama

Dans la vue **Jury** (/jury), bouton **📽️ Diapo** en haut à droite :

- Plein écran, photo uniquement
- Identifiant anonyme affiché
- Aucune note, aucun nom
- Utilisable sur un écran secondaire (vidéoprojecteur)

---

## 7. Sécurité

- ✅ Mots de passe hashés avec **bcrypt** (12 rounds)
- ✅ JWT signé côté serveur, rôle vérifié à chaque requête
- ✅ **Impossible** de s'inscrire en tant que juré/admin via `/register`
- ✅ **Métadonnées EXIF supprimées** via Sharp lors de l'upload
- ✅ Photos anonymisées pour le jury (identifiants aléatoires)
- ✅ L'admin voit uniquement les identifiants anonymes pendant les délibérations
- ✅ Notes verrouillées après validation (impossible de modifier)
- ✅ 1 seule soumission par catégorie par participant
- ✅ Journal d'audit complet de toutes les actions importantes
- ✅ Rate limiting : 200 req/15min global, 20 req/15min sur l'auth
- ✅ Helmet.js pour les headers HTTP
