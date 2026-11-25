# Registre STRIDE prévu

Toutes les menaces et leurs tests commencent au statut **Prévu**. Les protections sont des exigences de conception. Les risques restants décrivent la situation attendue après leur mise en œuvre, sans attester une réduction effective ou une acceptation du risque. La vérification documentaire ne fournit aucune preuve de sécurité d'exécution.

## Actifs et frontières de confiance

| Repère | Frontière et données concernées | Contrôle à placer |
|---|---|---|
| F1 | Utilisateur, liens entrants et contenu distant vers écrans, hooks et schémas mobiles | Entrées non fiables, destinations autorisées, DTO validés et rendu texte. |
| F2 | Mémoire applicative vers SecureStore et OS | Refresh seul en stockage sécurisé, gestion d'erreur et effacement. Profil, accès, conversations et brouillons restent en mémoire. |
| F3 | Mobile ou Web vers REST et handshake/transport Socket.IO | Canal chiffré, session, origine Web, quotas et validation de chaque payload. Les clients sont non fiables. |
| F4 | Handlers REST/Socket.IO vers services métier et rooms | Identité issue de session, contrôle d'appartenance et service d'envoi partagé. |
| F5 | Services métier vers Prisma/PostgreSQL | Transactions, contraintes, séquence, empreintes de refresh et rôle DB adapté. |
| F6 | Application et serveur vers journaux, captures et rapports | Données minimisées, corrélation neutre et preuve expurgée. |

Les actifs prioritaires sont accès/refresh, session et compte, données locales privées, participants de conversation, corps de message, clés d'idempotence, séquences et preuves. Le serveur voit le texte des messages dans le contrat actuel. La politique de rétention et de suppression reste à décider avec Mohamed et l'équipe.

## S — Usurpation

| Menace et scénario | Impact | Protection prévue | Propriétaire | Test futur | Risque restant attendu |
|---|---|---|---|---|---|
| S01, F2/F3/F4. Un accès volé ou un refresh rejoué ouvre une session ou une socket. | Lecture privée et envoi au nom d'autrui. | Accès court en mémoire, refresh SecureStore, rotation atomique et détection de rejeu, session active contrôlée et fermeture des sockets révoquées. | Mohamed pour serveur, Anas pour stockage/session. | STR-S01, jeton expiré/révoqué et ancien refresh sur REST, handshake, opération et réception déjà abonnée. | Un jeton valide volé reste exploitable jusqu'à expiration ou révocation. Appareil compromis. |
| S02, F1/F3. Configuration client altérée vers une fausse API, ou lien entrant trompeur. | Capture des identifiants ou ouverture d'un parcours privé trompeur. | Base API définie par environnement autorisé, HTTPS sans désactivation TLS en cible, destinations et UUID contrôlés. | Anas, Mohamed pour environnement API. | STR-S02, configuration cible HTTP refusée, certificat invalide rejeté, lien inconnu non suivi. | OS ou paquet modifié, environnement de développement à isoler. |

## T — Altération

| Menace et scénario | Impact | Protection prévue | Propriétaire | Test futur | Risque restant attendu |
|---|---|---|---|---|---|
| T01, F3/F4/F5. Payload impose expéditeur, vendeur ou participant, ou modifie le texte sous la même clé. | Attribution frauduleuse, messages incohérents ou accès élargi. | Entrées strictes, identité et vendeur dérivés serveur, comparaison clé/conversation/texte normalisé, conflit et transaction unique. | Mohamed, Anas pour protocole et tests. | STR-T01, champs injectés et même clé avec texte/conversation autorisée différents, en parallèle REST/socket. | Défaut partagé du service de normalisation ou de comparaison. |
| T02, F1/F2. Réponse tardive de A ou état local manipulé remplace les données de B. | Mélange de comptes et affichage trompeur. | Génération de session, annulation, sérialisation stockage, validation DTO et invalidation complète. Aucune permission déduite d'une donnée locale. | Anas. | STR-T02, logout A pendant refresh/lecture puis login B, réponses et écritures retardées. | Mémoire inspectable sur appareil compromis, effacement OS non garanti en cas d'erreur. |

## R — Répudiation

| Menace et scénario | Impact | Protection prévue | Propriétaire | Test futur | Risque restant attendu |
|---|---|---|---|---|---|
| R01, F3/F5. Un accusé perdu conduit à contester ou doubler un envoi déjà persisté. | Désaccord sur le résultat et doublons visibles. | Clé stable, identifiant serveur, séquence, date serveur, accusé après commit, reprise REST et état local indéterminé explicite. | Mohamed et Anas, Hanane pour rendu Web. | STR-R01, couper après commit avant accusé puis renvoyer même demande : un message et mêmes métadonnées. | La confirmation serveur n'atteste pas la lecture humaine, ni l'identité de la personne tenant l'appareil. |
| R02, F6. Une trace sans corrélation empêche d'établir le résultat d'un refus ou d'une panne. | Diagnostic et preuve de correction incomplets. | Corrélation requête/erreur, résultats de tests horodatés et expurgés, intégrité des artefacts sous responsabilité de leur producteur. | Anas et Mohamed, Abdelilah pour conservation des rapports. | STR-R02, relier une erreur API/ack à un cas de test sans corps privé ni secret dans l'artefact. | Ces traces ne constituent pas une preuve cryptographique de non-répudiation. |

## I — Divulgation d'information

| Menace et scénario | Impact | Protection prévue | Propriétaire | Test futur | Risque restant attendu |
|---|---|---|---|---|---|
| I01, F3/F4. C substitue conversation ou curseur, ou reste dans une room après révocation. | Fuite d'historique, d'aperçu ou d'événements. | Filtre d'appartenance sur chaque lecture et envoi, room serveur, contrôle des destinataires courants, refus 404 et retrait effectif des sockets. | Mohamed, Anas pour cas A/B/C, Hanane pour essai croisé. | STR-I01, C et admin non participant sur liste, historique, send, join/leave, curseur inter-conversation et réception après révocation. | Un participant autorisé peut conserver ou retransmettre ce qu'il a reçu. |
| I02, F2/F6. Refresh, courriel ou message se retrouve dans cache, logs, sauvegarde ou capture de test. | Compromission de compte ou de confidentialité. | Refresh SecureStore, accès mémoire, historique mémoire, no-store privé, redaction et exclusion des objets de requête complets, preuves fictives et expurgées. | Anas pour mobile, Mohamed pour logs serveur, Abdelilah pour artefacts. | STR-I02, inspection stockage/logs/paquet et relance, sauvegarde/réinstallation selon OS, compte A puis B. | Limites SecureStore et OS à mesurer, captures par l'utilisateur et appareil compromis. |
| I03, F1/F6. Le texte d'un produit ou message devient du HTML actif, un lien ouvert automatiquement ou une notification indiscrète. | Exfiltration, redirection ou exposition sur écran verrouillé. | Texte brut, aucune ouverture automatique, liens sortants à cadrer, minimisation des aperçus et permissions. | Anas et Hanane pour leurs interfaces. | STR-I03, charges HTML et URL malformées rendues en texte, aucun accès externe ou aperçu ajouté sans décision. | Capture écran et observation physique de l'écran. |

## D — Déni de service

| Menace et scénario | Impact | Protection prévue | Propriétaire | Test futur | Risque restant attendu |
|---|---|---|---|---|---|
| D01, F3/F4/F5. Rafales d'envoi et enregistrements volumineux alternent REST et socket. | Saturation serveur/DB et indisponibilité des conversations. | Quota partagé, limites Unicode et UTF-8, budgets d'abonnement et de conversation, validation avant travail coûteux. Seuils à confirmer. | Mohamed pour serveur, Anas pour comportement client. | STR-D01, charge bornée en test isolé, alternance transports et tailles limites, 429 cohérent et aucune boucle client. | Attaques distribuées et capacités d'infrastructure hors périmètre de cette étape. |
| D02, F1/F3. Reconnexion, multiples hooks ou immense historique épuisent batterie et mémoire. | Blocage du mobile et tempête de requêtes. | Socket unique, refresh partagé, un rattrapage actif, attente bornée, suspension arrière-plan, listes virtualisées et limites de tampon. | Anas, Mohamed pour coût des requêtes, Hanane pour Web. | STR-D02, multiples montages, réseau instable, gros historique fictif et débordement tampon, mesurer connexions/mémoire/requêtes. | Limite totale d'historique encore ouverte, conditions réseau et OS variables. |

## E — Élévation de privilèges

| Menace et scénario | Impact | Protection prévue | Propriétaire | Test futur | Risque restant attendu |
|---|---|---|---|---|---|
| E01, F3/F4/F5. Rôle injecté à l'inscription/profil ou rôle admin utilisé pour lire une conversation tierce. | Droits excessifs et accès global aux données privées. | Rôle imposé serveur, champs de profil en liste blanche, absence d'accès privé implicite pour admin, autorisations dans les requêtes. | Mohamed, Anas et Hanane pour cas clients. | STR-E01, rôle injecté → 400, profil d'autrui inaccessible, admin hors conversation → même 404. | Ajout ultérieur d'un endpoint privilégié nécessitant une revue propre. |
| E02, F4. Chemin Socket.IO ou secours REST contourne le contrôle présent sur l'autre transport. | Envoi ou abonnement sans droits malgré un client apparemment conforme. | Services communs, session et participation recalculées, validation du handshake indépendante du middleware CORS Express. | Mohamed et Anas. | STR-E02, même matrice session/participants sur REST et événements, révocation entre join et send et avant diffusion. | Dérive future entre contrôleurs ou délai de propagation de révocation à tester. |

## Revue et traçabilité

Les tests `STR-*` sont des identifiants de scénarios futurs. Leur exécution sera enregistrée selon le format de preuve de la [matrice de suivi](suivi.md). S01/T02/I02 alimentent surtout MOB-02 et MOB-07. S02/I03 alimentent MOB-03 et MOB-06. I01/E02 couvrent MSG-01 à MSG-05. T01/R01 couvrent MSG-03. D01/D02 couvrent MOB-04, MOB-08, MSG-05 et MSG-06. E01 couvre MOB-01 et MOB-07. R02 s'applique à toutes les preuves, et MOB-09 inclut l'exposition des aperçus de I03.

Priorité de conception proposée : session, contrôle d'accès tiers, idempotence et séparation des comptes avant les essais d'interopérabilité. La rétention, les limites mémoire et la révocation effective des destinataires restent à revoir avec Mohamed et Hanane. Aucun risque n'est déclaré traité sur la base de ce seul registre.
