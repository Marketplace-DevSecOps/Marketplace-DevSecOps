# Matrice de suivi mobile et messagerie

Étape client REST : les transports, validations et services ont des [preuves unitaires et en simulation](client-api-mobile.md). Ils ne valident pas les routes métier réelles, les fonctionnalités d’écran complètes, SecureStore ou Socket.IO. Les états initiaux de la matrice ci-dessous restent historiques.

Mise à jour : le [socle mobile](socle-mobile.md) apporte une réalisation partielle de MOB-03, MOB-08 et MOB-09. Les preuves limitées à cette étape sont consignées dans ce relevé ; elles ne valident pas les scénarios métier complets de la matrice initiale ci-dessous. MOB-01/MOB-02, les données du catalogue/profil et MSG-01 à MSG-06 restent à implémenter.

Références fonctionnelles conservées du [cahier Anas](../responsibilities/Anas_HALLOUMI.md). État initial au 25 novembre 2026 : **Prévu** pour chacune des quinze fonctionnalités et pour leurs preuves. L'[architecture](architecture.md) définit les chemins futurs. Les tests et artefacts ci-dessous sont des livrables attendus, sans fichier de résultat créé à cette étape.

## Statuts et preuves

| Statut | Condition de passage |
|---|---|
| Prévu | Conception ou scénario défini, aucune réalisation fonctionnelle validée. |
| Implémenté | Code identifié par commit et revue, preuve d'exécution encore à établir. |
| Validé en simulation | Test exécuté avec doubles/fixtures, périmètre de preuve précisé. La validation réelle reste à obtenir. |
| Validé réellement | Résultat reproductible contre les services réels requis et sur la plateforme revendiquée. Critères nominaux et négatifs réussis. |
| Bloqué | Dépendance précise identifiée, dernier résultat et action attendue renseignés. |

Pour chaque exécution, enregistrer référence MOB/MSG ou STR, commit, cas et données fictives, mode simulation ou intégration réelle, OS/appareil/émulateur, versions et type de build, état initial, conditions réseau, étapes, attendu, observé, résultat et lien vers preuve expurgée. Une preuve backend identifie aussi la migration et la base de test isolée. Pour un contrôle effectué uniquement par lecture de code, utiliser la mention « constat statique » avec fichier et révision.

Les tests unitaires réels de logique peuvent valider leur périmètre propre. Les mocks d'API ne valident pas permissions, transactions ou stockage natif. Une validation Android est rattachée à Android. Les cases iOS et navigateur demeurent prévues tant qu'aucune exécution appropriée n'est enregistrée. Abdelilah reçoit les commandes et rapports disponibles pour l'intégration future à sa pipeline.

## Mobile

Les suffixes `N` et `E` désignent un cas nominal et un cas d'erreur futurs, sans imposer l'organisation des fichiers de tests.

| Référence | Implémentation future et dépendance | Tests nominaux et négatifs prévus | Preuve attendue | État implémentation | État preuve |
|---|---|---|---|---|---|
| MOB-01 Inscription | `register.tsx`, formulaire auth, `auth.ts`, schémas. Mohamed fournit register et quota commun. | MOB-01-N, compte fictif créé puis login. MOB-01-E, champs invalides, rôle injecté, doublon concurrent, double soumission. | Tests formulaire et intégration register, requêtes/réponses expurgées. | Prévu | Prévu |
| MOB-02 Connexion et session | `SessionProvider`, `session.ts`, `secureStorage.ts`, `http.ts`. Dépend des variantes mobiles de Mohamed. | MOB-02-N, login, relance, rotation, logout. MOB-02-E, 401 concurrents, refresh rejoué/révoqué, réponse perdue, stockage en erreur, logout pendant refresh, A puis B. STR-S01/T02/I02. | Tests session, intégration serveur, inspection stockage et résultat de révocation par plateforme. | Prévu | Prévu |
| MOB-03 Navigation | Layouts, routes et garde, intention produit contrôlée. Origines entrantes et plateforme à décider. | MOB-03-N, produit puis connexion puis contact. MOB-03-E, UUID/lien invalide, chargement initial et retour après logout sans donnée privée. STR-S02. | Tests de navigation et parcours natif avec historique de retour. | Prévu | Prévu |
| MOB-04 Catalogue | `useProducts`, liste virtualisée, `products.ts`, DTO existant et `Page<T>`. Route produits de Mohamed. | MOB-04-N, charger/rafraîchir/atteindre fin de liste. MOB-04-E, page vide, doublons, page en erreur et annulation. | Tests de service et écran, pagination sur API réelle. | Prévu | Prévu |
| MOB-05 Recherche et filtres | `useProducts`, `useCategories`, client HTTP. Noms et tris proposés à revoir avec Mohamed/Hanane. | MOB-05-N, filtres combinés et curseur réinitialisé. MOB-05-E, min supérieur au max, prix invalide, réponse ancienne arrivée en dernier. | Tests des filtres et intégration ordonnée sur jeu fictif connu. | Prévu | Prévu |
| MOB-06 Détail produit | `products/[id].tsx`, `useProduct`, rendu texte et action contacter. API détail et conversation. | MOB-06-N, DTO public/prix en chaîne et contact. MOB-06-E, retiré/absent, DTO malformé, HTML et URL non exécutés. STR-I03. | Tests du DTO et de l'écran, intégration et revue des champs publics. | Prévu | Prévu |
| MOB-07 Profil | `profile.tsx`, `useProfile`, service profil et nettoyage session. Routes me de Mohamed. | MOB-07-N, lecture et changement nom public. MOB-07-E, rôle/courriel injectés, panne PATCH, réponse de A après login B. STR-T02/E01. | Tests du service et parcours A/B, contrôle des caches et données affichées. | Prévu | Prévu |
| MOB-08 Réseau et états | `AsyncState`, `ConnectionStatus`, cycle de vie, annulation et politiques de reprise. | MOB-08-N, nouvelle tentative explicite et retour au premier plan. MOB-08-E, mode avion, timeout, 429, refus TLS cible et absence de répétition automatique de mutation. STR-D02. | Tests des services et essais réseau sur appareil, compte des requêtes et limites observées. | Prévu | Prévu |
| MOB-09 Ergonomie | Champs, cartes, listes et saisie, labels, clavier et polices adaptables. Plateforme et orientation à retenir. | MOB-09-N, parcours complet avec grande police et aide d'accessibilité. MOB-09-E, clavier masquant saisie, texte long, retour/focus et erreur annoncée. | Grille manuelle par appareil, captures fictives expurgées et corrections recontrôlées. | Prévu | Prévu |

## Messagerie

| Référence | Implémentation future et dépendance | Tests nominaux et négatifs prévus | Preuve attendue | État implémentation | État preuve |
|---|---|---|---|---|---|
| MSG-01 Créer et lister | `useConversations`, `conversations.ts`, liste mobile. Service transactionnel de Mohamed et tri à valider avec Hanane. | MSG-01-N, créer/retrouver et lister ses conversations. MSG-01-E, création concurrente, propre produit, retiré, compte C et admin tiers. | Tests API sur PostgreSQL réel, unicité et liste filtrée, parcours mobile. | Prévu | Prévu |
| MSG-02 Historique | `useConversation`, `sync.ts`, `messageState.ts`, pagination REST. Historique serveur et curseurs de Mohamed. | MSG-02-N, pages croissantes fusionnées avec événements. MSG-02-E, curseur invalide/inter-conversation, arrivée hors ordre, trou, contenu contradictoire, tiers. | Comparaison ids/seq affichés avec messages persistés autorisés. | Prévu | Prévu |
| MSG-03 Envoyer et recevoir | Saisie, état des envois, `client.ts`, secours REST, service unique Message avec Mohamed. Hanane pour échanges croisés. | MSG-03-N, mobile vers Web et inverse. MSG-03-E, doublon REST/socket, même clé autre texte/conversation, concurrence, commit sans accusé et rollback. STR-T01/R01. | Un seul message en base, mêmes id/seq/date sur renvoi, refus et rendu unique des deux clients. | Prévu | Prévu |
| MSG-04 Rooms et sessions | `client.ts`, génération de session, join/leave, auth et destinataires contrôlés côté serveur. | MSG-04-N, ouvrir/quitter/changer de conversation. MSG-04-E, tiers C, room libre injectée, socket expirée/révoquée, A puis B et réponse tardive. STR-I01/E02. | Tests REST/socket réels et preuve d'absence de réception chez tiers/révoqué. | Prévu | Prévu |
| MSG-05 Reconnexion | `sync.ts`, repère contigu, reprise REST, cycle de vie et budgets de tentatives. | MSG-05-N, reconnecter/réautoriser/rattraper. MSG-05-E, trou sans coupure visible, perte d'événement après commit, background, rafale de déclencheurs, débordement tampon et panne prolongée. | Historique égal au jeu persisté autorisé, mesures de tentatives et test natif de cycle de vie. | Prévu | Prévu |
| MSG-06 Validation et limites | Schémas mobile/serveur, normalisation commune, tailles et quotas REST/socket. Seuils Mohamed/Hanane à approuver. | MSG-06-N, texte limite valide. MSG-06-E, vide après normalisation, Unicode et 8 Kio dépassés, champs inconnus, quota partagé et budget conversation. STR-D01. | Tests de bornes et charge contrôlée, erreurs/attentes cohérentes et absence de boucle. | Prévu | Prévu |

## Éléments déjà constatés et limites de la preuve

| Support présent dans le dépôt | Constat disponible | Portée pour les lignes ci-dessus |
|---|---|---|
| [DTO publics](../../backend/src/contracts/dto.ts), [erreurs](../../backend/src/contracts/errors.ts), [pagination](../../backend/src/contracts/pagination.ts) | Définitions présentes par lecture à `bf5faa6`. | Support de contrat pour MOB-04 à MOB-06 et futures listes. Aucune validation d'écran ou de route métier. |
| [Schéma Prisma](../../backend/prisma/schema.prisma) et [migration](../../backend/prisma/migrations/20261124171536_init/migration.sql) | Champs et contraintes présents par lecture. | Support de MSG-01 à MSG-03. Migration appliquée, transactions et concurrence non validées à cette étape. |
| [Tests backend](../../backend/tests) | Fichiers de tests présents dans le dépôt. | Aucun résultat d'exécution nouvellement constaté. Aucune ligne MOB/MSG promue sur cette base. |
| [Contrats](README.md) et diagrammes de ce dossier | Livrables documentaires disponibles. | Préparent les implémentations et scénarios. Aucun statut fonctionnel promu. |

Pour la première validation native, Android nécessite un appareil ou émulateur utilisable. L'analyse initiale avait détecté SDK/ADB mais aucun AVD listé, et le moteur Docker était indisponible. Ces constats devront être revérifiés au démarrage de l'implémentation. La disponibilité d'outils ne constitue pas une preuve de parcours mobile. La validation iOS et le comportement SecureStore par OS restent prévus.
