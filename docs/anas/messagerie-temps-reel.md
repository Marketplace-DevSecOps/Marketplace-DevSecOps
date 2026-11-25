# Contrat Socket.IO et reprise des messages

**Statut : proposition documentaire, serveur et client Socket.IO absents.** Les règles métier communes proviennent des cahiers Anas/Mohamed et des contraintes Prisma. Les enveloppes, délais et modalités précises ci-dessous sont à valider avec Mohamed et Hanane. Le [contrat REST](rest-mobile.md) définit les DTO, codes d'erreur et permissions communs.

## Identité et connexion

Proposition de transport : même origine API, chemin Socket.IO `/socket.io`, namespace `/`, transports compatibles Socket.IO polling et WebSocket, chiffrés en cible. Le chemin ne porte pas le préfixe REST `/api/v1`. Les versions client/serveur devront être compatibles et choisies lors de l'implémentation. Un client WebSocket brut ne suffit pas à consommer le protocole Socket.IO.

Handshake proposé, zone `auth` :

```json
{"accessToken":"<ACCESS_TOKEN>"}
```

Le mobile et le Web transmettent seulement l'accès courant en mémoire, jamais de refresh ni d'identifiant utilisateur imposé. Aucun jeton dans la query ou l'URL. Le handshake valide signature, algorithme, émetteur, audience, expiration, compte actif et session active. Les cookies ne constituent pas une preuve d'accès Socket.IO dans ce contrat.

La politique d'origines Web devra couvrir handshake et upgrade. L'absence d'Origin sur un client natif exige toujours le même contrôle de jeton et de permissions. Le middleware CORS Express existant ne constitue pas à lui seul une protection Socket.IO implémentée.

Connexion acceptée : événement standard `connect`, sans DTO métier. Connexion refusée : événement standard `connect_error`. Proposition : `err.data` contient exactement `ErrorBody` :

```json
{"error":{"code":"UNAUTHORIZED","message":"Authentication is required.","correlationId":"demo-socket-01"}}
```

`err.message` reste neutre. Le client exploite `err.data.error.code` si présent. Une erreur de transport dépourvue de `data` est traitée comme indisponibilité réseau, sans inventer de refus métier. Origin Web interdit → même format avec `CORS_FORBIDDEN`.

Une socket est liée à une session et un compte. Après renouvellement, la proposition est de reconnecter avec le nouvel accès, de réautoriser le join puis de reprendre l'historique. Le serveur revalide les droits à chaque opération et ferme les sockets expirées, révoquées ou d'un compte désactivé. Il empêche aussi leur réception de nouveaux contenus. Une room ne constitue pas une permission durable de réception.

`disconnect` est l'événement standard Socket.IO avec raison de transport ; il ne garantit pas un DTO d'erreur métier. Une fermeture forcée impose au client de vérifier sa session avant reconnexion. Le client conserve au plus une socket active pour sa session courante et vide ses écouteurs, buffers et données privées au changement de compte.

## Accusés et événements proposés

Les requêtes client utilisent le callback d'accusé Socket.IO. Champs d'entrée stricts, aucun nom de room libre. Les validations d'identifiant, d'expéditeur et d'appartenance sont identiques au REST.

```ts
type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: {
      code: ErrorCode
      message: string
      correlationId: string
      details?: FieldIssue[]
    }; retryAfterSeconds?: number }
```

`ErrorCode` et `FieldIssue` reprennent les définitions backend existantes. Pour un événement, `details.location` vaut `body` et `path` cible le champ du payload ; ce choix conserve le type existant et reste à valider avec Mohamed. `retryAfterSeconds` est un entier positif présent seulement pour `RATE_LIMITED`. Aucun statut HTTP n'est transporté dans un accusé.

| Événement et sens | Charge stricte | Accusé ou réception | Permission et refus attendus |
|---|---|---|---|
| `conversation:join`, client → serveur | `{conversationId}` | `SocketAck<{conversationId, lastMessageSeq}>` | Session active et participation. Tiers ou conversation inconnue → `NOT_FOUND`. Identifiant malformé → `VALIDATION_ERROR`. |
| `conversation:leave`, client → serveur | `{conversationId}` | `SocketAck<{conversationId}>` | Même contrôle de participation. Appel répété par participant → succès sans effet. Tiers → `NOT_FOUND`. Ne supprime aucun participant en base. |
| `message:send`, client → serveur | `{conversationId, clientMessageId, body}` | `SocketAck<MessageDto>` | Session et participation revérifiées, validation et quotas communs REST/socket. Join préalable inutile pour le droit d'envoyer. Identité injectée → `VALIDATION_ERROR`, tiers → `NOT_FOUND`, clé en conflit → `CONFLICT`. |
| `message:created`, serveur → clients | `MessageDto` direct | Aucun accusé métier demandé | Diffusion après commit aux sockets autorisées abonnées à cette conversation, émetteur compris s'il est abonné. Le client ne peut pas publier cet événement comme une écriture. |

`conversationId` et `lastMessageSeq` des accusés sont respectivement UUID et entier non négatif. Tous les événements client peuvent aussi échouer avec `UNAUTHORIZED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE` ou `INTERNAL_ERROR`. Aucun refus ne renvoie le contenu privé demandé. Événement inconnu : aucune opération ni diffusion ; le client ne doit pas attendre un accusé métier défini pour un événement hors contrat.

Le serveur calcule les rooms et ajoute seulement la socket courante. Un join répété reste idempotent. Le client quitte la conversation précédente avant de rejoindre la suivante et ignore les résultats tardifs d'une ancienne navigation. Mohamed doit borner les abonnements et tentatives d'entrée par socket/utilisateur. La valeur du budget par conversation reste une décision ouverte.

Succès proposé de join :

```json
{"ok":true,"data":{"conversationId":"55555555-5555-4555-8555-555555555555","lastMessageSeq":0}}
```

Succès proposé de leave :

```json
{"ok":true,"data":{"conversationId":"55555555-5555-4555-8555-555555555555"}}
```

Requête `message:send` :

```json
{"conversationId":"55555555-5555-4555-8555-555555555555","clientMessageId":"66666666-6666-4666-8666-666666666666","body":"Bonjour, le produit est-il disponible ?"}
```

Accusé d'envoi après persistance confirmée :

```json
{
  "ok":true,
  "data":{
    "id":"77777777-7777-4777-8777-777777777777",
    "conversationId":"55555555-5555-4555-8555-555555555555",
    "senderId":"11111111-1111-4111-8111-111111111111",
    "body":"Bonjour, le produit est-il disponible ?",
    "clientMessageId":"66666666-6666-4666-8666-666666666666",
    "seq":1,"createdAt":"2026-11-25T12:01:00.000Z"
  }
}
```

`message:created` transporte directement l'objet de `data`. L'accusé et cet événement peuvent arriver dans les deux ordres. Le client fusionne leur message par identifiant serveur.

Refus commun de join, leave ou send pour tiers :

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"The requested resource was not found.","correlationId":"demo-socket-02"}}
```

Conflit d'envoi :

```json
{"ok":false,"error":{"code":"CONFLICT","message":"The request conflicts with the current state.","correlationId":"demo-socket-03"}}
```

Quota :

```json
{"ok":false,"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again later.","correlationId":"demo-socket-04"},"retryAfterSeconds":12}
```

## Identifiants, texte et doublons

| Champ | Règle cible |
|---|---|
| `clientMessageId` | Clé générée une fois par le client pour un envoi logique. Proposition UUID v4 canonique, compatible avec la colonne existante de 64 caractères. Conservée sur timeout et passage REST/socket. Un nouveau message utilise une nouvelle clé. |
| `id` | UUID serveur du message persisté, stable sur tous les retours et transports. Clé du rendu et de la déduplication canonique. |
| `senderId` | Dérivé de la session serveur, jamais accepté dans une entrée d'envoi. |
| `seq` | Entier serveur strictement positif par conversation, alloué transactionnellement à partir de `lastMessageSeq`. Incrément de un pour chaque nouveau message validé, aucun incrément sur doublon ou rollback. |
| `createdAt` | Date serveur de création, stable sur doublon. Le tri fonctionnel utilise `seq`, même si l'horloge du téléphone diffère. |
| `body` | Texte brut privé. Proposition de normalisation commune avant validation : CRLF/CR vers LF, puis trim extérieur, sans transformation interne ni interprétation HTML. Même fonction serveur sur les deux transports. |

Proposition de taille : 1 à 2 000 points de code Unicode après normalisation, non vide ; aucune troncature silencieuse. Le service doit être compatible avec la limite PostgreSQL `varchar(2000)`. Tous les clients utilisent le même comptage, y compris pour les emoji. Une limite de 8 Kio UTF-8 pour la requête d'envoi sérialisée complète peut refuser un texte inférieur à 2 000 points de code. Les deux bornes s'appliquent. Le cadrage exact de la limite Socket.IO doit inclure son enveloppe et être mesuré avec Mohamed.

Corps trop long ou vide → `VALIDATION_ERROR`. Enveloppe applicative trop grande → `PAYLOAD_TOO_LARGE` si le serveur peut produire un accusé sûr. Si la limite du transport ferme la connexion avant traitement, aucun accusé n'est garanti. REST conserve la limite JSON générale de 64 Kio existante et devra appliquer en plus la limite spécifique d'envoi. Quota initial proposé : 30 tentatives d'envoi par minute/utilisateur, partagé entre REST et socket pour éviter le contournement, y compris les renvois. Budget par conversation à définir ; `Retry-After` REST ou `retryAfterSeconds` socket indique l'attente.

L'unique existant `(senderId, clientMessageId)` porte sur toutes les conversations de l'expéditeur. Après contrôle de session et d'accès, le service compare conversation et texte normalisé pour cette clé.

| Situation | Résultat requis côté service |
|---|---|
| Clé absente en base | Transaction d'insertion, allocation du numéro et mise à jour de conversation. Succès après commit seulement. |
| Même expéditeur, clé, conversation et texte normalisé | Retour du message déjà persisté avec mêmes `id`, `seq`, `createdAt`. Aucun nouvel incrément et aucune nouvelle diffusion déclenchée par le doublon. |
| Même expéditeur/clé, autre texte ou autre conversation autorisée | `CONFLICT` sans renvoyer le message associé à la clé. |
| Autre utilisateur employant la même clé | Espace de clés distinct, tout en vérifiant ses droits. |
| Envois simultanés REST/socket | Une insertion gagnante. Le concurrent relit puis applique les deux règles de doublon, après résolution de l'unicité. |
| Erreur avant commit | Rollback, aucun succès ni diffusion. Une reprise avec la même clé reste possible. |
| Commit réussi, accusé ou diffusion perdu | État client indéterminé jusqu'au renvoi idempotent ou à la reprise REST. Le succès n'atteste pas la lecture par le destinataire. |

États clients proposés : `pending`, `confirmed`, `failed`. Ils restent locaux et sont exclus de `MessageDto`. L'état `confirmed` vient du message canonique par accusé, événement ou historique. Un timeout laisse une possibilité de persistance ; proposer une reprise avec la même clé. Une modification du texte après cet état indéterminé doit attendre sa résolution avant de créer un nouvel envoi.

## Synchronisation et coupures

Le client conserve en mémoire, par conversation, les messages canoniques et le dernier `seq` **contigu** confirmé. Recevoir 12 quand 11 manque ne fait pas avancer ce repère au-delà de 10. Au redémarrage sans historique local, il repart de 0. Aucun mécanisme de lecture ou de notification avancée n'est défini ici.

1. Valider la session puis connecter la socket et installer l'écoute de `message:created`.
2. Demander `conversation:join` et mettre en tampon les événements autorisés de la conversation pendant la lecture REST.
3. Après succès de join, charger l'historique avec `afterSeq` égal au repère contigu local. Le `lastMessageSeq` du join est un repère serveur à rattraper, sans remplacer les messages manquants.
4. Suivre chaque `nextCursor` jusqu'à null, fusionner par `id`, réconcilier les envois locaux par `(senderId, clientMessageId)`, ordonner par `seq` et avancer seulement sur une plage contiguë.
5. Fusionner le tampon puis relancer une reprise si un trou reste ou si le repère du join n'est pas atteint. Borner les nouvelles tentatives et montrer l'état d'échec si le rattrapage n'aboutit pas.

Un message peut être persisté après le join et manquer dans les événements, notamment si le serveur s'arrête après commit. Proposition de contrôle supplémentaire pour la conversation ouverte : reprise REST toutes les 30 secondes au premier plan connecté, ainsi qu'au retour au premier plan, sur détection de trou et après reconnexion. L'intervalle et la charge sont à valider avec Mohamed et Hanane. La liste de conversations est relue à son ouverture et au retour au premier plan, puisque l'abonnement initial vise la conversation ouverte.

Reconnexion proposée avec délai exponentiel et aléa, de 1 à 30 secondes, cinq échecs consécutifs avant action explicite « Réessayer ». Sur `UNAUTHORIZED`, effectuer au plus un refresh coordonné si approprié puis reconnecter et rejoindre à nouveau. Ne pas répéter une demande refusée `NOT_FOUND` ou `CONFLICT`. Une mutation dont l'accusé manque peut basculer vers REST en gardant clé et texte identiques. Respecter le délai de quota.

Après déconnexion de compte, annuler requêtes, buffers et abonnements. Ignorer les réponses tardives associées à la session précédente. Les transferts et essais suivants doivent être rattachés à la session courante.

## Critères futurs de validation réelle

Ces scénarios sont à exécuter après implémentation contre les services et la base de test réels. Ils ne sont pas exécutés par cette étape documentaire.

| Scénario | Résultat à prouver |
|---|---|
| Acheteur mobile / vendeur Web, puis sens inverse | Même message canonique reçu, rendu une fois, uniquement chez les participants. |
| Compte C et admin non participant | Même `NOT_FOUND` que pour identifiant inconnu sur REST, join, leave et send ; aucune réception. |
| Session révoquée ou expirée pendant socket ouverte | Plus d'opération ni réception privée ; nettoyage et reconnexion contrôlés. |
| Double création et double envoi concurrents | Une conversation, un message par clé/expéditeur, aucune séquence allouée deux fois. |
| Même clé avec autre contenu ou autre conversation autorisée | Conflit cohérent sur REST et socket. |
| Coupure après commit avant accusé, ou arrêt avant diffusion | Reprise par même clé et historique, sans double persistance, sans trou après synchronisation. |
| Événement pendant chargement ou ordre inversé | Fusion correcte, watermark contigu, aucun rendu dupliqué. |
| Limites Unicode, UTF-8 et quota partagé | Bornes mesurées, erreur neutre, aucune boucle de renvoi. |
| Déconnexion A puis connexion B | Aucune donnée ni réponse tardive de A visible chez B. |

Les preuves devront identifier commit, plateforme, type de build et conditions réseau, sans jeton ni contenu privé. Les simulations d'écran et tests unitaires de fusion complètent ces essais ; la validation des permissions et des transactions exige les services réels.
