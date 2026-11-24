# Plan d'exécution — ELKHANFAF Mohamed (Back-end Express.js & sécurité API)

Source : `docs/responsibilities/Khanfaf_ELKHANFAF.md`. Chaque phase est lancée par la commande « do next ».
Statuts : `[ ]` à faire, `[~]` en cours, `[x]` terminé.

## Décisions techniques (à confirmer avant la phase 1)

- Code dans `backend/` (arborescence de la section 6 du cahier des charges).
- Node.js 24 LTS, TypeScript strict, Express 5, Prisma, PostgreSQL 16 via Docker Compose (base `dev` + base `test` isolée).
- Zod (validation), Helmet, CORS, pino (logs JSON expurgés), argon2 (Argon2id), jose (JWT), express-rate-limit, Socket.IO.
- Tests : Vitest + Supertest sur PostgreSQL réel. Lint : ESLint + typecheck `tsc --noEmit`.
- OpenAPI 3.1 dans `backend/src/contracts/openapi.yaml`.
- Secrets uniquement via `.env` (non commité) ; `.env.example` fourni.
- Un commit (et un push) par tâche.

## Phase 1 — Socle Express (API-13) `[~]`

- [x] Initialiser `backend/` : package.json, tsconfig strict, ESLint, Vitest, scripts `dev`, `build`, `test`, `lint`, `typecheck`.
- [x] `docker-compose.yml` PostgreSQL (dev + test), `.env.example`, `.gitignore`.
- [ ] Config typée validée par Zod au démarrage (échec si variable manquante).
- [ ] Chaîne middleware : corrélation (`X-Request-Id`) → logs pino expurgés → Helmet/CORS liste blanche → limite JSON 64 Kio → (emplacements quotas/auth/validation) → routeur `/api/v1` → 404 → gestionnaire d'erreurs central (code stable, message neutre, correlationId, jamais de stack).
- [ ] `trust proxy` configuré explicitement via env.
- [ ] `GET /api/v1/health` minimal (API-13).
- [ ] Tests : health, 404, JSON malformé, corps trop grand, origine CORS refusée, absence de stack trace, en-têtes Helmet.

## Phase 2 — Modèle de données, contrats et catégories (API-14) `[ ]`

- [ ] Schéma Prisma : User, Session, Category, Product, Conversation, ConversationParticipant, Message (contraintes, index, uniques, Decimal prix).
- [ ] Migration initiale + seed fictif (catégories, utilisateurs A/B/C/admin).
- [ ] Rôle PostgreSQL applicatif à privilèges limités séparé du rôle de migration (script SQL documenté).
- [ ] Middleware de validation Zod (params/query/body, `.strict()` refusant les champs inconnus).
- [ ] Conventions DTO et catalogue des codes d'erreur.
- [ ] Squelette OpenAPI couvrant API-01 à API-14.
- [ ] `docs/backend/data-dictionary.md` (classification public/privé/secret).
- [ ] `GET /api/v1/categories` (API-14) + tests (catégorie inactive exclue).
- [ ] Tests d'intégration : migrations sur base vierge, contraintes d'unicité.

## Phase 3 — Authentification, sessions et profil (API-01 à API-04) `[ ]`

- [ ] Hachage Argon2id (paramètres justifiés et mesurés).
- [ ] `POST /auth/register` : rôle USER forcé, rôle injecté rejeté, doublon concurrent → 409.
- [ ] `POST /auth/login` + `/auth/mobile/login` : erreur générique, quota 5 échecs/min compte+IP partagé entre variantes.
- [ ] Jeton d'accès JWT 10 min (alg, iss, aud, exp stricts) ; refresh opaque 7 j, empreinte en base, rotation atomique, détection de réutilisation → révocation de la famille.
- [ ] Web : cookie `HttpOnly; Secure; SameSite; Path` limité + contrôle Origin + CSRF. Mobile : refresh dans le corps, `Cache-Control: no-store`, aucun cookie accepté.
- [ ] `POST /auth/refresh|logout` et variantes mobiles.
- [ ] Middleware d'authentification vérifiant la session active en base.
- [ ] `GET/PATCH /users/me` (liste blanche de champs).
- [ ] Tests : mauvais mot de passe, compte désactivé, token altéré/expiré/mauvaise audience, refresh rejoué, renouvellements concurrents, mauvais transport, accès après révocation, absence de hash/token en réponse et en logs.

## Phase 4 — Catalogue et annonces (API-05 à API-08) `[ ]`

- [ ] `GET /products` : texte, catégorie, prix min/max, tri en liste blanche, pagination curseur (20 par défaut, 100 max).
- [ ] `GET /products/:id` : annonce active uniquement, vendeur minimal.
- [ ] `GET /users/me/products`, `POST /products` (vendeur issu de la session).
- [ ] `PATCH /products/:id` avec version (409 en conflit), `DELETE` = retrait logique.
- [ ] Politique 404 pour ressources d'autrui, documentée.
- [ ] Tests : BOLA A/B, propriétaire forgé, champs supplémentaires, bornes de prix, injection SQL, pagination, édition concurrente, double retrait, annonce retirée invisible.

## Phase 5 — Conversations, messages et temps réel (API-09 à API-11) `[ ]`

- [ ] Services partagés REST/Socket.IO : création/récupération de conversation (transactionnelle, unique), vendeur dérivé du produit, acheteur ≠ vendeur.
- [ ] `POST/GET /conversations`, `GET /conversations/:id/messages` (curseur par numéro de séquence).
- [ ] `POST /conversations/:id/messages` : séquence par conversation, idempotence `clientMessageId` (même contenu → même message, sinon 409), accusé après commit.
- [ ] Module `realtime` : authentification Socket.IO, rooms dérivées du serveur, contrôle participant à l'entrée et à l'envoi, `message:send` utilisant le même service, enveloppe 8 Kio, quota 30 msg/min, déconnexion des sockets à la révocation.
- [ ] Tests : créations concurrentes, doublons, expéditeur usurpé, tiers C (REST et socket), ordre, reprise d'historique, révocation pendant socket ouvert.

## Phase 6 — Intégration de l'assistant IA (API-12) `[ ]`

- [ ] Interface fournisseur + implémentation mock (point de branchement pour le module d'Abdelilah).
- [ ] `POST /assistant/chat` : session requise, quota utilisateur+IP, validation entrée/sortie, timeout.
- [ ] Outil unique autorisé : recherche dans le catalogue public via le service produits ; aucun SQL ni URL arbitraire.
- [ ] Prompts non journalisés en entier.
- [ ] Tests : non connecté, quota 429, panne/lenteur fournisseur, sortie malformée, outil inconnu, référence à une donnée privée.

## Phase 7 — Durcissement transversal `[ ]`

- [ ] Quotas sur inscription, annonces, conversations, messages (429 + `Retry-After`).
- [ ] Revue Helmet/CORS/cookies/proxy ; inventaire des routes exposées vs OpenAPI (test automatique).
- [ ] Tests de résilience : DB indisponible, erreur en cours de transaction (rollback), arrêt propre.
- [ ] Test d'expurgation des logs (aucun mot de passe, token, cookie, corps de message).
- [ ] Matrice sécurité visiteur/A/B/C/admin sur toutes les routes à identifiant.
- [ ] Exécuter `npm audit`, Semgrep, Gitleaks localement ; corriger, ajouter tests, consigner dans un registre.

## Phase 8 — Documentation et preuves de clôture `[ ]`

- [ ] OpenAPI finalisé avec exemples anonymisés.
- [ ] `docs/backend/` : politique de session, matrice rôles/permissions/tests, STRIDE (flux, actifs, propriétaire, mitigation, test, risque résiduel), correspondances OWASP API 2023 / Web 2025.
- [ ] Guide d'exploitation : démarrage, migrations, erreurs, corrélation, limites, données de démo.
- [ ] Matrice d'acceptation (section 13) avec preuve par critère.
- [ ] Script de démonstration de soutenance (succès et refus).
- [ ] Section Tier 1 Prates & Pereira laissée en attente de la source exacte (non reconstruite).

## Hors périmètre / dépendances externes

- Handlers de protocole messagerie détaillés : Anas (le socle serveur est fourni en phase 5).
- Module IA réel : Abdelilah (mock en phase 6).
- Pipeline CI et DAST ZAP : Abdelilah (Mohamed fournit scripts, comptes fictifs et corrections).
