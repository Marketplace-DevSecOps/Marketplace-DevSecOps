# Contrat REST pour le client mobile

Statut de tous les endpoints ci-dessous, sauf health mentionné dans le [point d'entrée](README.md) : **cible documentaire, routes absentes**. Les formats ajoutés sont des propositions à valider avec Mohamed et, pour les échanges communs, Hanane.

## Conventions conservées et exposition

Base `/api/v1`. Requêtes et réponses JSON, `Content-Type: application/json` pour les corps. Les identifiants de ressources sont des UUID v4 opaques issus du modèle existant. Dates serveur ISO 8601 UTC avec millisecondes. Les schémas de requête seront stricts : champs inconnus, identifiants invalides et paramètres répétés refusés avec `400 VALIDATION_ERROR`. Un champ obligatoire absent est invalide. `null` est autorisé seulement lorsqu'il figure dans un DTO.

Les réponses de succès renvoient directement le DTO ou `Page<T>`. Aucun emballage `data` global n'est ajouté au REST. Les corps ci-dessous sont des définitions de contrat documentaires, sans génération de code.

| Données | Exposition prévue |
|---|---|
| Produit actif, catégorie active, vendeur public | Lecture publique. Champs limités aux DTO existants ci-dessous. |
| Courriel et profil courant | Compte concerné, obtenu par sa session. |
| Conversation, participants, dernier aperçu et messages | Participants autorisés uniquement, y compris lorsqu'un admin demande l'accès. |
| Mot de passe, jetons bruts | Transport des seuls échanges de session nécessaires sous HTTPS. Aucun journal, URL, rapport ou cache ordinaire. |
| `passwordHash`, `refreshTokenHash`, famille et métadonnées internes de session | Serveur uniquement, jamais dans les réponses. |
| `role`, `status`, `lastReadSeq`, version produit | Exclus des DTO définis ici. Le rôle et l'état restent contrôlés côté serveur. |

Tout accès protégé utilise `Authorization: Bearer <ACCESS_TOKEN>` et exige compte actif, jeton valide et session active en base. Les routes mobiles de refresh/logout utilisent la preuve opaque précisée plus bas. Cible conservée : accès mémoire, refresh dans SecureStore, historiques en mémoire, nettoyage au changement de compte. HTTPS et Socket.IO chiffré sont requis en cible. L'exception HTTP locale éventuelle devra être isolée et documentée.

## DTO publics existants

Ces formats reprennent exactement `backend/src/contracts/dto.ts`.

```ts
type CategoryDto = { id: string; label: string }
type PublicSellerDto = { id: string; displayName: string }
type ProductDto = {
  id: string
  title: string
  description: string
  price: string
  currency: string
  categoryId: string
  seller: PublicSellerDto
  createdAt: string
  updatedAt: string
}
type Page<T> = { items: T[]; nextCursor: string | null }
```

Le prix possède exactement deux décimales, par exemple `"1250.50"`. Le modèle et la migration bornent le prix à `0.01..1000000.00`, devise `MAD` uniquement. Les calculs et comparaisons serveur utilisent le décimal. Le client traite prix et bornes comme chaînes décimales, sans arrondi implicite en flottant. Le DTO exclut courriel du vendeur, statut de publication et version. Titre et description sont du texte brut.

## Erreurs et pagination existantes

Le [catalogue existant](../../backend/src/contracts/errors.ts) et les [conventions API](../backend/api-conventions.md) font référence pour tous les endpoints.

| HTTP et code | Usage |
|---|---|
| 400 `VALIDATION_ERROR` | Champs, filtres ou curseur invalides. `details` décrit seulement emplacement, chemin et règle neutre. |
| 400 `BAD_REQUEST` / `MALFORMED_JSON` | Rejet HTTP générique / JSON illisible. |
| 401 `UNAUTHORIZED` | Session invalide, identifiants de connexion incorrects ou compte désactivé, sans révéler la cause précise. |
| 403 `FORBIDDEN` / `CORS_FORBIDDEN` | Action interdite hors confidentialité d'une ressource / origine Web refusée. |
| 404 `NOT_FOUND` | Ressource absente, retirée du public ou privée à un tiers. Même réponse neutre pour existence inconnue et accès tiers, avec corrélation propre à chaque requête. |
| 409 `CONFLICT` | Courriel déjà utilisé ou clé d'envoi réutilisée pour une autre demande. |
| 413 `PAYLOAD_TOO_LARGE` | Limite du corps dépassée. |
| 415 `UNSUPPORTED_MEDIA_TYPE` | Encodage ou charset non supporté selon le gestionnaire existant. |
| 429 `RATE_LIMITED` | Quota. Cible prévue : en-tête `Retry-After` en secondes entières. Middleware de quota absent. |
| 500 `INTERNAL_ERROR` / 503 `SERVICE_UNAVAILABLE` | Erreur inattendue / dépendance indisponible. |

Exemple de refus d'accès à une conversation d'un tiers, HTTP 404 :

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found.",
    "correlationId": "demo-request-01"
  }
}
```

Le corps d'erreur utilise `Cache-Control: no-store` et `X-Request-Id` égal à `correlationId`. Le client utilise `code` pour sa logique. Les valeurs reçues, secrets, contenu de message et détails techniques sont exclus des erreurs. Les réponses de compte, session et messagerie utiliseront aussi `Cache-Control: no-store` (proposition). La configuration CORS expose actuellement `X-Request-Id`. L'exposition navigateur de `Retry-After` reste à prévoir avec Mohamed pour Hanane.

La pagination réutilise `limit` entier de 1 à 100, défaut 20, et `cursor` optionnel non vide de 512 caractères maximum. Réponse `Page<T>`, page vide `{"items":[],"nextCursor":null}`. Le serveur lit `limit + 1` éléments et utilise le dernier élément rendu pour produire le curseur. Encodage base64url canonique d'une position JSON validée côté serveur. Le client renvoie le curseur sans le fabriquer ou le modifier. Chaque lecture conserve ses filtres d'accès. Une borne dépassée est rejetée.

Proposition de position interne spécifique par route : champ `scope`, clés de tri et contexte de filtres ou conversation. Un curseur provenant d'une autre route ou d'un autre contexte donne `400 VALIDATION_ERROR`. Cela précise les schémas de position à ajouter sans remplacer les helpers existants. La liste publique peut évoluer pendant la pagination ; un rafraîchissement repart sans curseur et les clients dédupliquent par identifiant.

## Inscription, session mobile et profil

Nouveaux DTO proposés, champs obligatoires :

```ts
type CurrentUserDto = { id: string; email: string; displayName: string }
type MobileSessionDto = {
  user: CurrentUserDto
  tokenType: 'Bearer'
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
}
```

Les expirations sont des dates UTC serveur. Les durées effectives sont fournies par le serveur. Les cibles prévisionnelles de dix minutes et sept jours restent à confirmer. Proposition : sept jours absolus par famille depuis la connexion, rotation sans prolongation silencieuse. Les claims JWT, l'émetteur et l'audience sont à fixer avec Mohamed ; le mobile ne déduit aucune permission de leur simple décodage.

| Endpoint absent | Entrée et succès proposés | Permission et refus spécifiques |
|---|---|---|
| `POST /auth/register` | `{email, displayName, password}` → 201 `CurrentUserDto`, puis connexion explicite. | Public sous quota. Courriel normalisé trim/minuscules, unique ; 409 si doublon. `role` injecté → 400. |
| `POST /auth/mobile/login` | `{email, password}` → 200 `MobileSessionDto`. | Public sous quota commun avec login Web. Mauvais identifiants ou compte désactivé → même 401. |
| `POST /auth/mobile/refresh` | `{refreshToken}` → 200 nouvelle `MobileSessionDto`. | Preuve opaque mobile requise, aucun Bearer expiré exigé. Jeton expiré, révoqué, inconnu ou déjà utilisé → 401. |
| `POST /auth/mobile/logout` | `{refreshToken}` → 204, corps vide. | Preuve opaque liée à la famille à révoquer, aucun Bearer exigé. Répétition ou jeton opaque inconnu → même 204 proposé. Corps absent/malformé → 400. |
| `GET /users/me` | Aucun corps → 200 `CurrentUserDto`. | Session active ; aucune sélection d'utilisateur par le client. Sans session → 401. |
| `PATCH /users/me` | `{displayName}` → 200 `CurrentUserDto` actualisé. | Session active. Corps vide, nom vide, courriel, rôle, identifiant ou mot de passe injecté → 400. |

Propositions de validation à approuver : courriel valide de 254 caractères maximum, nom public trim de 1 à 50 points de code Unicode, mot de passe de 12 à 128 points de code, sans trim ni transformation. Confirmation du mot de passe vérifiée dans le formulaire et exclue de la requête. Ces bornes du mot de passe ne sont pas encore implémentées. Les tailles de courriel et de nom respectent les colonnes existantes.

Les routes mobiles ne créent ni n'utilisent de cookie de renouvellement Web. Proposition stricte : présence d'un en-tête Cookie sur ces variantes → 400 `BAD_REQUEST`. Le navigateur Web utilise ses variantes cookie avec contrôles Origin/CSRF. Mohamed doit convenir du comportement exact et le tester avant branchement. Un aperçu Expo dans un navigateur ne fournit aucune preuve de fonctionnement de SecureStore natif.

Rotation cible : transaction atomique remplaçant l'empreinte, ancien refresh marqué utilisé, nouveau refresh renvoyé une seule fois. Réutiliser un ancien refresh révoque sa famille. Proposition logout : révoquer toute la famille courante, fermer ses sockets et rendre ses accès inutilisables, sans déconnecter les familles des autres appareils. Même un refresh déjà utilisé doit permettre de révoquer sa famille au logout, sans créer de nouvelle session. Le serveur n'expose aucune métadonnée du jeton reçu.

Le client groupe tous les refresh concurrents, enregistre le nouveau refresh dans SecureStore avant de reprendre les requêtes et retente au plus une fois une lecture après succès. Les mutations suivent leur politique d'idempotence ; seul l'envoi de message conserve explicitement sa clé. Un refresh dont la réponse est perdue laisse une rotation indéterminée : proposition de retour à la connexion, sans rejouer automatiquement l'ancien refresh. Un échec de stockage impose un nettoyage local et une tentative de révocation du nouveau jeton si disponible.

À la déconnexion, vider accès, refresh, profil, historiques, brouillons et abonnements locaux. Si le réseau empêche le logout, l'effacement local ne prouve pas la révocation serveur ; signaler ce résultat dans les vérifications.

Exemple de requête d'inscription fictive :

```json
{"email":"acheteur@example.invalid","displayName":"Acheteur démo","password":"<MOT_DE_PASSE_A_FOURNIR>"}
```

Succès proposé de l'inscription, du profil courant ou de sa mise à jour (201 pour inscription, 200 pour profil) :

```json
{"id":"11111111-1111-4111-8111-111111111111","email":"acheteur@example.invalid","displayName":"Acheteur démo"}
```

Succès de login ou refresh, marqueurs secrets non utilisables :

```json
{
  "user":{"id":"11111111-1111-4111-8111-111111111111","email":"acheteur@example.invalid","displayName":"Acheteur démo"},
  "tokenType":"Bearer",
  "accessToken":"<ACCESS_TOKEN>",
  "accessTokenExpiresAt":"2026-11-25T12:10:00.000Z",
  "refreshToken":"<NOUVEAU_REFRESH_TOKEN>",
  "refreshTokenExpiresAt":"2026-12-02T12:00:00.000Z"
}
```

Corps de refresh/logout `{"refreshToken":"<REFRESH_TOKEN>"}`. Refus de login/refresh HTTP 401 :

```json
{"error":{"code":"UNAUTHORIZED","message":"Authentication is required.","correlationId":"demo-request-02"}}
```

## Produits, catégories et recherche

| Endpoint absent | Entrée et succès proposés | Permission et refus |
|---|---|---|
| `GET /products` | Query ci-dessous → 200 `Page<ProductDto>`. | Public, produits actifs seuls. Filtre, tri, UUID ou curseur invalide → 400. Aucun résultat → page vide 200. |
| `GET /products/:id` | UUID v4 → 200 `ProductDto`. | Public. Identifiant malformé → 400, absent ou retiré → 404. |
| `GET /categories` | `limit`, `cursor` → 200 `Page<CategoryDto>`. | Public, catégories actives seules. Query ou curseur invalide → 400. |

Les DTO de catégorie et produit existent. La forme paginée de la réponse catégories est une proposition pour borner la liste, à convenir avec Mohamed et Hanane.

| Filtre produit proposé | Définition |
|---|---|
| `q` | Texte trim non vide, 1 à 120 points de code. Absent pour tout le catalogue. Recherche littérale insensible à la casse dans titre ou description, sans interprétation SQL des caractères `%` et `_`. Gestion des accents à confirmer ; proposition initiale sensible aux accents. |
| `categoryId` | UUID v4. Catégorie inconnue ou inactive bien formée → page vide proposée. |
| `minPrice`, `maxPrice` | Chaînes canoniques à deux décimales sans signe ni exposant, bornes inclusives `0.01..1000000.00`. Min ≤ max. Devise unique MAD. |
| `sort` | `newest` par défaut, `price_asc`, `price_desc`. Autre valeur → 400. |
| `limit`, `cursor` | Contrat commun ci-dessus. Réinitialiser le curseur à tout changement de filtre ou tri. |

Ordres proposés : `newest` = `(createdAt DESC, id DESC)` ; `price_asc` = `(price ASC, id ASC)` ; `price_desc` = `(price DESC, id DESC)`. Chaque curseur contient les valeurs de la dernière paire, le tri et les filtres normalisés. Catégories ordonnées par `id ASC`, curseur sur `id`. La recherche reste bornée côté serveur et les requêtes obsolètes sont annulées ou ignorées côté client.

Exemple `GET /products?q=Clavier&minPrice=100.00&maxPrice=300.00&sort=price_asc&limit=20`, succès 200 :

```json
{
  "items":[{
    "id":"33333333-3333-4333-8333-333333333333",
    "title":"Clavier démo","description":"Description fictive en texte brut.",
    "price":"250.00","currency":"MAD",
    "categoryId":"44444444-4444-4444-8444-444444444444",
    "seller":{"id":"22222222-2222-4222-8222-222222222222","displayName":"Vendeur démo"},
    "createdAt":"2026-11-25T10:00:00.000Z","updatedAt":"2026-11-25T10:00:00.000Z"
  }],
  "nextCursor":null
}
```

Le détail retourne directement l'objet produit de `items`. Catégories, succès 200 :

```json
{"items":[{"id":"44444444-4444-4444-8444-444444444444","label":"Informatique"}],"nextCursor":null}
```

Exemple de prix invalide `minPrice=12.345`, HTTP 400 :

```json
{"error":{"code":"VALIDATION_ERROR","message":"The request is invalid.","correlationId":"demo-request-03","details":[{"location":"query","path":"minPrice","code":"invalid_value","message":"Invalid value."}]}}
```

## Conversations et messages

DTO privés proposés. `PublicSellerDto` est réutilisé pour les vues minimales d'acheteur et vendeur, sans élargir ses champs.

```ts
type MessageDto = {
  id: string
  conversationId: string
  senderId: string
  body: string
  clientMessageId: string
  seq: number
  createdAt: string
}
type ConversationDto = {
  id: string
  productId: string
  buyer: PublicSellerDto
  seller: PublicSellerDto
  lastMessageSeq: number
  lastMessage: MessageDto | null
  createdAt: string
  updatedAt: string
}
```

`lastMessageSeq` vaut 0 et `lastMessage` vaut null avant tout envoi. Sinon l'aperçu canonique correspond au dernier numéro, dans une lecture cohérente. `updatedAt` évolue au commit d'un nouvel envoi. La liste référence le produit par `productId` ; un produit retiré peut être rendu indisponible sans exposer son ancien détail. Aucun compteur de non-lus ni reçu de lecture n'est défini par la présence de `lastReadSeq` en base.

| Endpoint absent | Entrée et succès proposés | Permission et refus |
|---|---|---|
| `POST /conversations` | `{productId}` → 201 `ConversationDto` créée, 200 même DTO si déjà existante. | Session active acheteur, vendeur dérivé du produit. Produit absent/retiré → 404, propre produit → 403. Participant/vendeur/acheteur injecté → 400. |
| `GET /conversations` | `limit`, `cursor` → 200 `Page<ConversationDto>`. | Session active ; seulement ses conversations. Aucun filtre `userId`. |
| `GET /conversations/:id/messages` | `limit`, `cursor` ou `afterSeq` → 200 `Page<MessageDto>`. | Session active participante ; tiers ou identifiant inconnu → 404. |
| `POST /conversations/:id/messages` | `{clientMessageId, body}` → 201 `MessageDto` nouveau, 200 même DTO pour renvoi identique. | Session active participante ; mêmes permissions et service que Socket.IO. Tiers → 404, contenu modifié pour même clé → 409. |

Tous peuvent aussi retourner les erreurs communes de validation, session, quota et dépendance. La création concurrente conserve une conversation unique et les deux participants définis par le serveur. Les contraintes Prisma empêchent certains doublons ; le service devra encore garantir les deux participants et leur cohérence avec le produit.

Liste proposée par `(createdAt DESC, id DESC)` pour une pagination stable malgré les nouveaux messages ; curseur contenant cette paire et le scope `conversations`. Hanane doit valider ce choix d'ergonomie avant intégration.

Historique proposé en ordre `seq ASC`. Sans curseur, `afterSeq` vaut 0. `afterSeq` entier `0..2147483647` désigne le dernier numéro contigu confirmé localement ; demander strictement les numéros suivants. Une valeur supérieure au dernier numéro donne une page vide, sans modifier la position locale. `cursor` et `afterSeq` sont exclusifs. Le curseur interne contient scope `messages`, `conversationId` et dernier `seq` rendu. La suite utilise `nextCursor` jusqu'à null. Une nouvelle reprise repart de `afterSeq` contigu et revalide les droits. Charger les dernières pages en sens inverse sera une évolution à convenir avec Hanane.

Création de conversation, exemple de corps :

```json
{"productId":"33333333-3333-4333-8333-333333333333"}
```

Succès 201 ou 200 pour conversation retrouvée :

```json
{
  "id":"55555555-5555-4555-8555-555555555555",
  "productId":"33333333-3333-4333-8333-333333333333",
  "buyer":{"id":"11111111-1111-4111-8111-111111111111","displayName":"Acheteur démo"},
  "seller":{"id":"22222222-2222-4222-8222-222222222222","displayName":"Vendeur démo"},
  "lastMessageSeq":0,"lastMessage":null,
  "createdAt":"2026-11-25T12:00:00.000Z","updatedAt":"2026-11-25T12:00:00.000Z"
}
```

Liste de conversations, succès 200 :

```json
{
  "items":[{
    "id":"55555555-5555-4555-8555-555555555555",
    "productId":"33333333-3333-4333-8333-333333333333",
    "buyer":{"id":"11111111-1111-4111-8111-111111111111","displayName":"Acheteur démo"},
    "seller":{"id":"22222222-2222-4222-8222-222222222222","displayName":"Vendeur démo"},
    "lastMessageSeq":0,"lastMessage":null,
    "createdAt":"2026-11-25T12:00:00.000Z","updatedAt":"2026-11-25T12:00:00.000Z"
  }],
  "nextCursor":null
}
```

Envoi, corps fictif REST :

```json
{"clientMessageId":"66666666-6666-4666-8666-666666666666","body":"Bonjour, le produit est-il disponible ?"}
```

Message canonique de succès (201 ou 200 sur doublon identique) :

```json
{
  "id":"77777777-7777-4777-8777-777777777777",
  "conversationId":"55555555-5555-4555-8555-555555555555",
  "senderId":"11111111-1111-4111-8111-111111111111",
  "body":"Bonjour, le produit est-il disponible ?",
  "clientMessageId":"66666666-6666-4666-8666-666666666666",
  "seq":1,"createdAt":"2026-11-25T12:01:00.000Z"
}
```

Historique demandé avec `afterSeq=0`, succès 200 après cet envoi :

```json
{
  "items":[{
    "id":"77777777-7777-4777-8777-777777777777",
    "conversationId":"55555555-5555-4555-8555-555555555555",
    "senderId":"11111111-1111-4111-8111-111111111111",
    "body":"Bonjour, le produit est-il disponible ?",
    "clientMessageId":"66666666-6666-4666-8666-666666666666",
    "seq":1,"createdAt":"2026-11-25T12:01:00.000Z"
  }],
  "nextCursor":null
}
```

Refus de réutilisation de clé avec un autre contenu ou une autre conversation, HTTP 409 :

```json
{"error":{"code":"CONFLICT","message":"The request conflicts with the current state.","correlationId":"demo-request-04"}}
```

Les règles détaillées des clés, des séquences, des tailles et de la reprise figurent dans le [contrat temps réel](messagerie-temps-reel.md) et s'appliquent aussi au REST.
