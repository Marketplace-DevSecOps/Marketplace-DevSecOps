# Documentation mobile et messagerie — Anas

Révision documentaire du 25 novembre 2026, sur le code local au commit `bf5faa6`.

## Statut et lecture

Ce dossier définit une cible d'intégration. Aucun endpoint métier présenté ici n'est disponible dans le routeur actuel. Seul `GET /api/v1/health` y est monté. Aucun essai réseau, test mobile ou test de messagerie n'est attesté par ces documents. Les exemples sont fictifs et les marqueurs entre chevrons remplacent des secrets, sans être des valeurs utilisables.

| Mention | Signification |
|---|---|
| Existant | Définition ou comportement présent dans les fichiers du dépôt, constaté par lecture. L'exécution reste à vérifier. |
| Cible conservée | Orientation concordante des cahiers des charges, à implémenter. Elle ne constitue pas une validation collective des détails du protocole. |
| Proposition | Choix précis introduit ici, à valider avec les propriétaires indiqués avant intégration. |

- [Contrat REST mobile](rest-mobile.md) couvre compte, sessions, profil, consultation, conversations et messages.
- [Contrat Socket.IO et reprise](messagerie-temps-reel.md) couvre authentification, événements, accusés, idempotence et synchronisation.
- [Architecture prévue](architecture.md) décrit navigation Expo, couches mobiles, session, transports et état des messages.
- [Diagrammes de flux](flux.md) illustrent connexion/rotation, conversation/envoi et reconnexion/rattrapage.
- [Registre STRIDE](stride.md) relie actifs et frontières aux scénarios, protections, propriétaires, tests et risques restants.
- [Matrice de suivi](suivi.md) prépare les implémentations et preuves MOB-01 à MOB-09 et MSG-01 à MSG-06.

## Références réutilisées

| Source | Éléments conservés |
|---|---|
| [Conventions API](../backend/api-conventions.md) | Erreurs, confidentialité par 404, DTO à liste blanche, prix en chaîne, dates UTC, pagination. |
| [DTO existants](../../backend/src/contracts/dto.ts) | `CategoryDto`, `PublicSellerDto`, `ProductDto` sans ajout de champ. |
| [Pagination existante](../../backend/src/contracts/pagination.ts) | `Page<T>`, limite 20/100, curseur base64url canonique de 512 caractères maximum. |
| [Catalogue d'erreurs](../../backend/src/contracts/errors.ts) | Codes et statuts HTTP stables, structure `ErrorBody`. |
| [Schéma Prisma](../../backend/prisma/schema.prisma) et [migration initiale](../../backend/prisma/migrations/20261124171536_init/migration.sql) | Champs, tailles, uniques et contraintes SQL existants. Leur présence ne prouve pas leur application sur une base. |
| [Routeur](../../backend/src/app/routes.ts) | État réel des routes montées. |
| [Cahier Anas](../responsibilities/Anas_HALLOUMI.md) | Mobile, protocole, reprise et scénarios. |
| [Cahier Mohamed](../responsibilities/Khanfaf_ELKHANFAF.md) et [plan backend](../plan/ELKHANFAF_phases.md) | Services, sessions, persistance, autorisations et intégration serveur. |
| [Cahier Hanane](../responsibilities/Hannane_ELFADIL.md) | Consommation commune REST/Socket.IO et interface Web. |

Les cahiers sont conservés. Cette documentation complète leur contrat sans modifier les responsabilités. Les futures définitions exécutables et OpenAPI devront être alignées avec Mohamed pour conserver une source commune.

## Disponibilité constatée

| Élément | État local |
|---|---|
| Health et infrastructure d'erreur/validation | Code présent. |
| DTO publics, pagination, tables de compte et de messagerie | Définitions présentes. |
| Inscription, sessions mobiles, profil | Routes et services absents. |
| Produits, catégories, conversations, messages | Routes et services absents, malgré les modèles Prisma. |
| Socket.IO, schémas exécutables des événements | Absents. |
| Application mobile et interface Web | Dossiers absents. |

## Décisions à valider

Tous les statuts HTTP de succès, nouveaux DTO et formats de requête détaillés dans les deux contrats sont des propositions. Les éléments existants explicitement référencés restent la base.

| Décision | Proposition documentée | Validation attendue |
|---|---|---|
| Compte et profil | Inscription sans ouverture de session, DTO courant minimal, modification du nom public seul, bornes du mot de passe. | Mohamed, puis Hanane pour le compte commun. |
| Sessions mobiles | Réponse avec expirations explicites, rotation stricte, expiration absolue de famille, logout idempotent de la famille courante. | Mohamed. Cibles 10 min/7 jours et gestion de la réponse de refresh perdue à confirmer. |
| Catalogue | Noms des filtres, tris, recherche littérale, catégories paginées. | Mohamed et Hanane. |
| Produit public | Conserver exactement `ProductDto`, sans `status`, `version` ni images. | Hanane prévoit un état de publication dans son cahier. Aligner son besoin sur le DTO existant avant tout ajout. |
| Conversation | DTO privé minimal avec produit référencé et dernier message, liste stable par date de création. | Mohamed et Hanane, notamment le tri souhaité pour la liste. |
| Annonce retirée | Refuser la création/retrouvaille via produit retiré. Historique existant accessible et nouveaux messages autorisés aux participants actifs dans la durée de rétention convenue. | Mohamed et équipe. Politique de rétention et suppression de compte à décider avant livraison. |
| Historique | Parcours croissant par `seq`, depuis 0 ou un dernier numéro contigu connu, sans pagination arrière initiale. | Mohamed et Hanane pour le volume et l'ergonomie. |
| Envois | UUID v4 client, normalisation de texte, enveloppe 8 Kio, quota commun REST/socket. | Mohamed et Hanane. 2 000 caractères présents en base, comptage et seuils de transport à confirmer. |
| Socket.IO | Namespace `/`, chemin `/socket.io`, `auth.accessToken`, accusés `ok/data` et `ok/error`. | Mohamed et Hanane, y compris refus de handshake et expiration d'une socket ouverte. |

## Vérification des étapes documentaires et suite

Les étapes de contrats et d'architecture portent uniquement sur `docs/anas/`. La vérification documentaire couvre 41 liens locaux résolus, 24 exemples JSON analysables, l'encodage UTF-8, les clôtures de blocs et l'absence d'espaces finaux dans ce dossier. Un contrôle structurel vérifie les trois blocs Mermaid, leurs participants et leurs branches. Le rendu et l'analyse par un moteur Mermaid n'ont pas été exécutés, aucun moteur local n'ayant été détecté dans les emplacements vérifiés.

La matrice comprend les 15 références attendues, toutes avec implémentation et preuve au statut Prévu. Le registre STRIDE comprend 13 menaces et leurs tests futurs. Les empreintes des deux contrats et du cahier Anas ont été comparées avant et après cette étape d'architecture, sans changement. Le contrôle Git global relève toujours un espace final dans la modification préexistante du cahier Anas.

Les scénarios décrits sont des critères futurs à exécuter. Des réponses simulées pourront servir aux écrans en étant signalées comme telles. La validation d'intégration exigera les services réels et PostgreSQL de test. La prochaine étape proposée est la revue des décisions, de l'architecture et des risques avec Mohamed et Hanane, puis les schémas exécutables partagés et le socle Expo lors d'une étape d'implémentation autorisée.
