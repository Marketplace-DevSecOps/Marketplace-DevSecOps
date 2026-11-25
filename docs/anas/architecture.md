# Architecture prévue du mobile et de la messagerie

Le [client REST mobile](client-api-mobile.md) est désormais implémenté dans les services et schémas de mobile/src. Le mode réel reste distinct du mock, et les écrans ainsi que l’orchestration de session restent à intégrer.

Mise à jour : le [socle mobile](socle-mobile.md) réalise désormais les dispositions, les routes provisoires et les états communs dans `mobile/`. Son README précise le regroupement des routes privées sous `(authenticated)`. Les services métier et les flux décrits ci-dessous restent prévisionnels.

Statut initial **Prévu**, au 25 novembre 2026, référence locale `bf5faa6`. Cette architecture est une proposition documentaire fondée sur les [contrats REST](rest-mobile.md), le [contrat temps réel](messagerie-temps-reel.md) et le [cahier Anas](../responsibilities/Anas_HALLOUMI.md). Les chemins ci-dessous désignent des fichiers futurs. Les routes métier, le mobile et Socket.IO restent absents du dépôt.

## Organisation et responsabilités

Le flux prévu suit écran → hook de fonctionnalité → service typé → transport HTTP ou Socket.IO → service métier serveur → Prisma. Les DTO sont validés aux frontières et les permissions sont recalculées sur le serveur. Le mobile consomme des schémas sans dépendre du client Prisma, de la configuration ou des secrets serveur.

| Emplacement futur | Rôle et dépendances |
|---|---|
| `mobile/app/_layout.tsx` | Composition des fournisseurs de session, cycle de vie et navigation. État de démarrage explicite avant toute route privée. |
| `mobile/app/index.tsx` | Entrée vers le catalogue public. |
| `mobile/app/(public)/login.tsx`, `register.tsx` | Formulaires, validation, clavier et états de soumission. |
| `mobile/app/(main)/_layout.tsx`, `index.tsx` | Navigation principale et catalogue accessible au visiteur. Les groupes Expo organisent les routes, leurs noms ne font pas partie des URL. |
| `mobile/app/(main)/profile.tsx`, `conversations/index.tsx` | Profil et liste des conversations, garde de session sur ces routes. |
| `mobile/app/products/[id].tsx` | Détail public, destination entrante autorisée. |
| `mobile/app/conversations/[id].tsx` | Conversation privée, contrôle local de session puis autorisation réelle par API et join. |
| `mobile/src/components/` | `FormField`, `AsyncState`, `ProductCard`, `MessageBubble`, `ConnectionStatus`. Labels accessibles, texte brut et états réutilisables. |
| `mobile/src/features/auth/` | `SessionProvider`, `useSession`, formulaires et orchestration de session. |
| `mobile/src/features/products/` | `useProducts`, `useProduct`, `useCategories`, recherche et pagination. |
| `mobile/src/features/profile/` | `useProfile`, mise à jour du nom public. |
| `mobile/src/features/messaging/` | `useConversations`, `useConversation`, liste, historique, saisie et états d'envoi. |
| `mobile/src/services/http.ts` | Instance Axios, URL publique API, timeout, annulation, ajout Bearer aux routes autorisées et conversion des erreurs. |
| `mobile/src/services/auth.ts`, `products.ts`, `profile.ts`, `conversations.ts` | Méthodes REST alignées sur les contrats, validation des réponses et aucune logique d'écran. `conversations.ts` porte aussi historique et secours d'envoi REST. |
| `mobile/src/services/secureStorage.ts` | Adaptateur SecureStore pour le refresh, lecture/écriture/effacement avec erreurs explicites. |
| `mobile/src/services/session.ts` | Accès en mémoire, refresh unique partagé, restauration et invalidation. Utilise un transport d'authentification sans interception de refresh récursive. |
| `mobile/src/realtime/client.ts` | Socket unique liée à la session, écouteurs, authentification, join/leave et accusés. |
| `mobile/src/realtime/sync.ts` | Orchestration du rattrapage REST, tampon d'événements et reprises bornées. |
| `mobile/src/features/messaging/messageState.ts` | Fusion pure, index par identifiant, réconciliation des envois et repère contigu. |
| `mobile/src/schemas/` | Schémas d'entrée et de réponse compatibles avec les contrats existants et les bornes décidées. |
| `mobile/src/hooks/useAppLifecycle.ts` | Déclencheurs premier plan/arrière-plan, annulation et synchronisation. |
| `mobile/src/tests/` | Emplacements futurs des tests de session, services, écrans et fusion. Moteur compatible Expo à choisir. |

Mohamed conserve les modules backend `auth`, `users`, `products`, `conversations`, `messages` et leurs transactions et autorisations. Les handlers `realtime` sont réalisés avec Anas et appellent les mêmes services que REST. Les tables et helpers de contrat existants sont réutilisés. Hanane possède les vues Web et partage DTO, événements et scénarios. Abdelilah reçoit les besoins de tests et les preuves pour sa pipeline.

L'emplacement d'un éventuel paquet de schémas partageables avec le Web reste à convenir avec Mohamed et Hanane. D'ici là, les documents font référence et aucun nouveau paquet partagé n'est présumé disponible.

## Navigation et écrans

| Destination | Accès et comportement prévu |
|---|---|
| Catalogue, recherche et détail | Public. Chargement, vide, erreur, fin de page et produit indisponible. |
| Connexion et inscription | Public. Une soumission active à la fois. Inscription puis connexion explicite selon le contrat proposé. |
| Profil et conversations | Session validée. Pendant la restauration, afficher le chargement de session. En absence de session, proposer la connexion. |
| Conversation | Session validée, UUID valide, puis lecture et join autorisés. Un refus 404 vide la vue et arrête son abonnement. |
| Action « Contacter » | Mémoriser en mémoire une intention interne limitée au produit. Après connexion, revalider le produit puis créer/retrouver la conversation. |

Les destinations entrantes sont limitées aux routes connues avec UUID valide. La première destination publique retenue est le produit. Tout autre type de lien demande un cadrage. Les origines et le schéma d'application Expo restent à décider avec l'équipe. Une destination mémorisée est effacée si invalide ou lors d'un changement de compte. Le retour après logout ne doit plus montrer de donnée privée. La garde d'écran complète les contrôles serveur.

Chaque écran sépare chargement initial, rafraîchissement, soumission et erreur. Les hooks annulent les requêtes obsolètes. Ils associent toute réponse à la session et à la version de requête qui l'a initiée, afin qu'une réponse tardive du compte A ou d'un ancien filtre soit ignorée.

## Client HTTP et session

| Sujet | Décision d'architecture prévue |
|---|---|
| Configuration | URL API publique sous `/api/v1`, validée au démarrage. HTTPS en cible, configuration locale isolée. Aucun secret embarqué. Timeout initial proposé de 15 secondes, à mesurer et valider avec Mohamed. |
| Réponses | Valider les DTO et `Page<T>`, conserver les prix en chaîne. Distinguer erreurs API par `code`, annulation, timeout et indisponibilité réseau. |
| Corrélation | Réutiliser `X-Request-Id` et `correlationId` pour les diagnostics expurgés. Exclure corps privés, credentials et configuration de requête Axios complète des journaux. |
| Interception 401 | Une promesse de refresh partagée pour toutes les lectures concurrentes. Exclure register/login/refresh/logout de ce mécanisme. Une lecture est retentée au plus une fois après succès. |
| Mutations | Aucune répétition générale automatique. L'envoi de message peut être repris avec sa clé stable. Une création de conversation peut être retentée explicitement selon son contrat d'unicité. |
| Quota | Attente indiquée par `Retry-After` ou accusé Socket.IO, sans boucle de renvoi. |
| Session | États proposés `restoring`, `anonymous`, `authenticated`, `refreshing`, `signingOut`. L'accès reste en mémoire et le refresh seul dans SecureStore. |
| Restauration | Lire SecureStore puis appeler refresh. Seule une réponse valide, enregistrée avec succès, ouvre les vues privées. Absence de refresh → visiteur. |
| Rotation | Écriture sécurisée du nouveau refresh avant libération des lectures en attente. Réponse de refresh perdue → retour à la connexion selon le contrat, sans répétition automatique de l'ancien jeton. |
| Logout | Capturer la preuve de révocation en mémoire pour l'appel, invalider immédiatement l'état courant, annuler les lectures et effacer stockage, caches, brouillons et écouteurs. Une panne de réseau laisse la révocation serveur non confirmée. |

Un compteur de génération de session, purement local et sans jeton, associe callbacks, timers et requêtes au compte courant. L'invalidation incrémente ce compteur avant nettoyage. Une opération de refresh terminant après logout ne peut ainsi rétablir l'ancienne session. Si elle a déjà obtenu un nouveau refresh, tenter sa révocation puis l'écarter.

Les opérations locales de stockage et d'invalidation doivent être sérialisées pour éviter qu'une écriture tardive recrée un refresh après son effacement. En cas d'échec de SecureStore, suspendre l'accès privé et rendre l'erreur explicite. L'effacement mémoire ou la révocation best effort ne prouvent pas que le stockage a été supprimé. Relever l'échec sans afficher le jeton et recontrôler au prochain démarrage. Le comportement de sauvegarde, verrouillage et réinstallation reste à vérifier sur chaque OS retenu.

## Historique, synchronisation et déduplication

| État mémoire, par session et conversation | Invariant prévu |
|---|---|
| Messages canoniques indexés par `id` | Une seule occurrence par identifiant serveur. Même `id` avec données contradictoires → anomalie et resynchronisation, sans remplacement silencieux. |
| Index `seq` vers `id` | Ordre serveur strict. Deux identifiants pour un même `seq` déclenchent une erreur de cohérence. |
| Envois locaux par `(senderId, clientMessageId)` | Clé créée une fois, texte normalisé figé pendant une tentative indéterminée. Réconciliation avec accusé, événement ou historique. |
| Repère contigu | Avance uniquement lorsque tous les numéros depuis le repère précédent sont présents. Une réception isolée hors ordre ne suffit pas. |
| `nextCursor` | Opaque, attaché à la requête d'historique courante. Après interruption, reprise depuis `afterSeq` contigu. |
| Tampon pendant rattrapage | Événements validés de la conversation courante et de la génération de session courante seulement. |

Le coordinateur installe les écouteurs avant join, puis charge les pages REST en ordre croissant. Il fusionne réponses et tampon, réconcilie les envois, puis recherche les trous. Le `lastMessageSeq` du join sert de cible minimale à rattraper. Un simple accusé de connexion ne valide pas ce rattrapage. Au redémarrage sans historique mémoire, `afterSeq` repart de 0.

Les délais de reconnexion de 1 à 30 secondes, cinq échecs consécutifs et le contrôle REST toutes les 30 secondes au premier plan reprennent les propositions du contrat temps réel. Un seul rattrapage par conversation est actif, les déclencheurs concurrents sont regroupés. Sur 404, arrêter la conversation. Sur 401, passer par la session. Sur quota, attendre le délai fourni.

Les tampons, historiques et reprises doivent être bornés. Proposition initiale à convenir avec Mohamed et Hanane : interrompre le tampon après 500 événements, marquer la vue désynchronisée et reprendre via REST depuis le repère contigu. Le volume total d'historique conservé et le nombre de pages par cycle restent à définir avant implémentation. L'approche croissante depuis 0 exige cette décision pour les longues conversations. L'arrière-plan suspend le contrôle périodique et les reprises actives, puis le premier plan relance validation de session et rattrapage. La stratégie de fermeture de socket en arrière-plan sera vérifiée sur appareil.

Le contenu est affiché en texte, sans exécution HTML ni ouverture automatique de liens. Le changement de conversation nettoie l'abonnement précédent. La liste est rafraîchie à son ouverture et au premier plan. Les reçus de lecture, notifications et caches privés persistants demandent un contrat complémentaire.

## Points à confirmer et ordre de réalisation

1. Mohamed et Hanane relisent les contrats, les DTO, les décisions de pagination et les limites mémoire.
2. Anas choisit versions Expo, moteur de tests et plateforme native de validation, puis prépare navigation et services lors d'une étape d'implémentation autorisée.
3. Mohamed livre les routes de compte et consultation pour leur intégration réelle.
4. Anas et Mohamed raccordent les handlers aux services transactionnels existants ou futurs, puis Hanane intègre les mêmes événements au Web.
5. Exécuter les scénarios de la [matrice de suivi](suivi.md) et du [registre STRIDE](stride.md), sur chaque plateforme revendiquée.

L'architecture ajoute comme propositions une génération locale de session, la sérialisation du stockage, un timeout HTTP initial et une borne de tampon. Ces choix demandent revue avant implémentation. Les [diagrammes de flux](flux.md) décrivent les échanges cibles. Aucune fonctionnalité mobile n'est déclarée réalisée par cette documentation.
