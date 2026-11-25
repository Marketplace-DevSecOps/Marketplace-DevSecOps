# Client API mobile — configuration et preuves

Étape du 25 novembre 2026, après le socle au commit 6939a03. Périmètre : mobile et documentation Anas. Le routeur backend monte toujours uniquement GET /api/v1/health ; les endpoints métier ci-dessous restent des cibles documentaires, non des fonctionnalités serveur disponibles.

## Organisation et contrats

| Fichier dans mobile/src/ | Responsabilité |
|---|---|
| services/config.ts | Lecture explicite des variables publiques Expo, choix réel/mock et validation de l’origine. |
| services/http.ts | Instance Axios commune, délai total, AbortSignal, statuts attendus, validation des réponses et délai de reprise. |
| services/errors.ts | ApiError neutre, catalogue HTTP, détails de champs filtrés, corrélation et Retry-After. |
| schemas/api.ts | Schémas Zod des entrées, DTO publics/privés et pages selon les contrats. |
| services/auth.ts | register, login mobile, refresh mobile et logout mobile. |
| services/users.ts | GET/PATCH users/me, sans sélection libre de compte ni changement de rôle. |
| services/products.ts | Liste filtrée/paginée et détail public. |
| services/categories.ts | Liste paginée publique. |
| services/conversations.ts | Liste privée et création/retrouvaille depuis un produit. |
| services/messages.ts | Historique croissant et envoi REST avec clientMessageId fourni par l’appelant. |
| services/mock/ | Données fictives et adaptateur Axios déterministe en mémoire. |
| services/index.ts | Fabrique commune createServices et accès paresseux getApiServices. |
| components/ServiceModeNotice.tsx | Mention visible des données fictives dans tous les écrans du socle. |

Les réponses REST restent directement les DTO ou Page<T>, sans enveloppe globale data. Les services retournent ces valeurs validées. Le bundle expose mode et chaque ApiError expose source pour distinguer réel/mock. Le transport mock emprunte les mêmes chemins, services, normalisations et schémas que le transport réel ; aucune capture d’erreur ne remplace une réponse réelle par des fixtures.

Les DTO publics reprennent les champs de backend/src/contracts/dto.ts, sans importer Prisma ou le code serveur. Les schémas privés consomment les propositions de rest-mobile.md. Les décisions d’intégration avec Mohamed et Hanane restent à confirmer ; aucun nouveau paquet partagé ni contrat backend n’est créé.

Les contrôles comprennent : UUID v4, dates UTC à trois décimales, prix MAD en chaîne à deux décimales, bornes des pages/curseurs, absence de champs imprévus, cohérence du dernier message et de la conversation, identifiant du produit demandé, ordre croissant des messages et conversation attendue. Les prix sont comparés en centimes entiers. Les corps de message suivent CRLF/CR vers LF puis trim, comptage Unicode et limite REST de 8 Kio sérialisés. Les paramètres cursor et afterSeq sont exclusifs.

Les listes ont au maximum 100 éléments et ne dépassent pas la limite demandée. Ces contrôles bornent les données exposées après réception ; ils ne constituent pas une garantie de limite mémoire du transport natif avant réception.

## Configuration depuis la racine du dépôt

Commandes pour le terminal Windows cmd :

~~~cmd
cd mobile
copy .env.example .env
~~~

Modifier uniquement les variables publiques nécessaires dans mobile/.env, puis relancer Expo et recharger complètement l’application. Le fichier est ignoré par Git. Ne jamais y placer de mot de passe, jeton d’accès, refresh token, secret serveur ou clé IA. Expo incorpore les variables EXPO_PUBLIC_* dans le code de l’application.

| Variable | Valeur et comportement |
|---|---|
| EXPO_PUBLIC_API_MODE | real par défaut ; mock uniquement sur sélection explicite. Toute autre valeur est rejetée. |
| EXPO_PUBLIC_API_URL | Origine et chemin /api/v1 obligatoires en réel, sans identifiants, query ni fragment. Pas de valeur réelle implicite. |
| EXPO_PUBLIC_API_TIMEOUT_MS | 15000 par défaut, entier entre 100 et 60000. |
| EXPO_PUBLIC_ALLOW_LOCAL_HTTP | true autorise uniquement localhost, loopback et IPv4 privées, lorsque __DEV__ est vrai. |

En livraison, HTTPS est requis même si l’exception HTTP est renseignée. Le client ne désactive aucune vérification TLS et ne modifie pas les politiques natives de cleartext/ATS. L’acceptation d’une URL locale par JavaScript ne prouve pas son accessibilité ni son autorisation par la plateforme.

La validation est paresseuse : sans URL réelle, les écrans provisoires peuvent s’afficher, mais le premier appel getApiServices échoue avec configuration. Il ne bascule pas en mock.

## Réseau selon la plateforme

Constats du poste : Windows, Node 24.18, npm 11.16, SDK Android présent. Le relevé adb devices ne montre aucun appareil ; emulator -list-avds ne montre aucun AVD. Aucun test sur téléphone ou émulateur n’a été exécuté.

Le Compose existant publie le backend sur 127.0.0.1:3000 seulement. Ne pas confondre le port Metro/Expo (8081 par défaut) et le port de l’API (3000).

| Plateforme | URL de développement pour l’API | Conditions |
|---|---|---|
| Navigateur du poste Windows | http://localhost:3000/api/v1 | Exception locale activée. Ajouter l’origine exacte du navigateur Expo aux origines CORS convenues avec Mohamed. |
| Émulateur Android standard | http://10.0.2.2:3000/api/v1 | 10.0.2.2 désigne le loopback du poste hôte. Nécessite un AVD lancé ; non essayé ici. |
| Android physique par USB | http://127.0.0.1:3000/api/v1 | Redirection adb reverse du port 3000 après autorisation USB sur le téléphone. |
| Android/iPhone physique par Wi-Fi | URL HTTPS d’API accessible au téléphone | Le binding Docker actuel n’est pas accessible via l’IP LAN du PC. Faire préparer avec Mohamed une API/passerelle HTTPS joignable. Une URL HTTP privée ne suffit pas à changer ce binding. |
| Simulateur iOS | À configurer sur un poste macOS | Le poste Windows ne permet pas une validation sur simulateur iOS. |

Exemple USB Android, à exécuter seulement avec un appareil réellement connecté. Remplacer DEVICE_ID par le résultat de devices :

~~~cmd
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" devices -l
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" -s DEVICE_ID reverse tcp:3000 tcp:3000
~~~

La connexion à Metro est distincte : utiliser le réseau Expo joignable ou rediriger également son port effectif pour une connexion USB/localhost. Un tunnel Expo pour Metro n’expose pas automatiquement l’API du port 3000.

Le backend autorise actuellement par défaut l’origine Web localhost:5173 et expose seulement X-Request-Id. Mohamed doit faire convenir l’origine effective d’Expo Web et l’exposition de Retry-After pour que le navigateur puisse lire cette indication. Ce client ne change pas sa configuration CORS. Les clients natifs ne bénéficient pas d’une protection d’authentification par CORS.

Pour vérifier l’accessibilité, GET /api/v1/health est le seul endpoint existant. Un health positif ne prouve pas la disponibilité des routes de compte, catalogue ou messagerie.

## Erreurs, annulation et reprise

ApiError expose kind, code, status si disponible, correlationId validé si disponible, fields neutres, retryAt si fourni et source. Les objets Axios, corps bruts, headers d’authentification, messages serveur et causes d’origine ne sont pas conservés dans cette erreur. Aucun service n’écrit ces données dans des logs.

| Situation | kind |
|---|---|
| Entrée invalide / HTTP 400 | validation |
| HTTP 401 | unauthorized |
| HTTP 403 | forbidden |
| HTTP 404, y compris accès privé refusé | not_found |
| HTTP 409 | conflict |
| HTTP 429 | rate_limited |
| HTTP 5xx | server |
| Autre refus HTTP, dont 413/415 | http |
| Serveur inaccessible | network |
| Délai écoulé | timeout |
| Annulation explicite | cancelled |
| DTO, JSON ou statut de succès inattendu | invalid_response |
| Configuration absente/invalide | configuration |

Le catalogue de codes connu conserve les correspondances HTTP du backend. Un corps d’erreur malformé ou un code incohérent avec le statut ne masque pas le statut HTTP. Les détails de validation ne transmettent que les chemins connus, un code neutre et un message local ; aucune valeur reçue n’est réaffichée.

Chaque opération accepte { signal } avec AbortController. Le délai Axios et un AbortController interne bornent l’attente ; le signal de l’appelant est propagé et son écouteur est retiré à la fin. Une annulation ou un timeout d’une mutation ne prouve pas que le serveur a annulé sa transaction.

Retry-After est accepté en secondes entières et, par robustesse HTTP, en date IMF-fixdate. Sur 429/5xx avec délai valide, retryAt conserve l’échéance. retryDelayMs(error) fournit le délai restant. Une nouvelle demande explicite sur la même méthode et le même chemin est rejetée localement jusqu’à l’échéance ; les autres routes restent disponibles. Cette indication en mémoire est bornée à 100 routes, sans garantie de quota ni persistance. Les dates HTTP reposent sur l’horloge du poste ; préférer les secondes prévues au contrat pour limiter le décalage d’horloge.

Il n’y a aucune nouvelle tentative automatique, y compris après 401, 429 ou 5xx. Aucun ordonnanceur ne rejoue une requête après le délai. L’inscription, le login, le refresh et les PATCH ne sont jamais relancés implicitement. Même l’envoi idempotent d’un message reste une action explicite avec la même clé fournie par l’appelant.

Les statuts de succès attendus sont vérifiés avant le DTO : inscription 201, logout 204 vide, lectures/login/refresh/profil 200, création/retrouvaille de conversation et envoi/doublon de message 201 ou 200. Aucun succès local n’est créé en mode réel.

## Mode mock

Dans mobile/.env :

~~~dotenv
EXPO_PUBLIC_API_MODE=mock
~~~

L’URL réelle est ignorée. Tous les écrans affichent MODE MOCK — DONNÉES FICTIVES, et les services exposent mode=mock. Le mode n’est jamais activé par une panne réseau ou une route absente.

Compte exclusivement fictif : acheteur@example.invalid ; mot de passe de simulation Mock-passphrase-2026! Les nouvelles inscriptions mock doivent employer ce même mot de passe fixe ; aucun mot de passe fourni n’est conservé. Le domaine example.invalid, les noms, annonces et messages ne correspondent à personne.

Chaque createServices en mode mock crée son propre état en mémoire. IDs, ordre initial et réponses sont reproductibles ; pas d’aléa, réseau ou stockage persistant. Le mock couvre lectures/filtrage/pagination, inscription, login, rotation simulée, logout, profil, conversations et messages avec idempotence de clé. Les curseurs mock sont opaques et propres à la simulation, jamais destinés au serveur réel. Les tokens préfixés mock- et leurs dates fixes de 2030 sont des marqueurs fictifs, sans valeur d’authentification ni simulation fidèle des délais d’expiration.

Les états de simulation disparaissent au rechargement. Les quotas, PostgreSQL, transactions concurrentes, TLS, cookies Web, Socket.IO et comportement natif ne sont pas validés par ce mock.

## Utilisation et limites d’intégration

~~~ts
import { getApiServices } from './src/services';
import { ApiError, retryDelayMs } from './src/services/errors';

const services = getApiServices();
const controller = new AbortController();
try {
  const page = await services.products.list({ limit: 20 }, { signal: controller.signal });
  // Afficher page.items et conserver page.nextCursor sans le décoder.
  // services.mode identifie le transport choisi.
} catch (error) {
  if (error instanceof ApiError) {
    const remaining = retryDelayMs(error);
    // Rendre l’erreur et une action explicite selon kind / remaining.
  }
}
// Au nettoyage de l’écran : controller.abort().
~~~

Les futurs appels privés utiliseront createServices(readApiConfig(), { accessToken: getterEnMemoire }). Le Bearer n’est ajouté qu’aux routes privées ; les routes publiques et auth n’en reçoivent pas. Le refresh demeure un corps d’authentification explicite. Aucun token n’est lu depuis une variable publique.

SessionProvider et services/session.ts restent anonymes dans le socle. Cette étape ne réalise pas SecureStore, la restauration/rotation coordonnée de session, le nettoyage multi-compte ni les formulaires ou listes métier. Les écrans restent provisoires ; la couche de services est disponible pour leur prochaine intégration. Les tests injectent les jetons fictifs uniquement dans leurs propres bundles.

## Vérifications

Résultats du 25 novembre 2026 sur les changements locaux non encore commités :

| Vérification | Résultat |
|---|---|
| Installation npm | Axios 1.21.1 et Zod 4.6.7 installés ; lockfile mis à jour. |
| npm run typecheck | Réussi. |
| npm test -- --watch=false | 6 suites, 57 tests réussis, dont les 10 tests du socle existant. |
| Vérification Expo des versions en mode hors ligne | Dépendances déclarées à jour selon les versions locales du SDK. |
| npm run export:web, mode réel sélectionné | Réussi, 902 modules ; génération Web, sans validation visuelle de navigateur. |
| Appareil / émulateur / API métier réelle | Non exécuté. |

Les tests couvrent notamment DTO/JSON/statuts de succès invalides, erreurs normalisées et neutralisées, timeout avec abort interne, annulation avant/pendant la demande, Retry-After en secondes/date, blocage avant échéance, absence de réémission automatique, séparation des headers privés, entrées rejetées avant transport, déterminisme du mock, rotation simulée, isolement des comptes et idempotence explicite des messages. Le bandeau mock est vérifié par test de composant.

Les tests HTTP utilisent des adaptateurs de test et les tests mock une simulation : aucun succès d’API métier réelle ni essai sur appareil n’en est déduit. Les tests de navigation du socle s’exécutent également en simulation. Les caches Jest/Metro et les exports restent ignorés par Git.

Commandes depuis mobile :

~~~cmd
npm run typecheck
npm test -- --watch=false
npm run export:web
~~~

## Sources

Documentation officielle consultée le 25 novembre 2026 :

- Axios : https://axios-http.com/docs/req_config ; https://axios-http.com/docs/cancellation ; https://axios-http.com/docs/handling_errors
- Zod : https://zod.dev/basics
- Expo, variables publiques : https://docs.expo.dev/guides/environment-variables/
- Android Emulator : https://developer.android.com/studio/run/emulator-networking-address
- React Native, appareil et adb reverse : https://reactnative.dev/docs/running-on-device
- Sémantique Retry-After : https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3

Axios 1.21.1 et Zod 4.6.7 sont les seules dépendances directes ajoutées. npm et le lockfile mobile sont conservés ; le lockfile backend, Docker et les workflows restent inchangés.
