# Secure Marketplace — socle mobile

Étape du 25 novembre 2026. Application Expo / React Native en TypeScript avec Expo Router. Les écrans sont provisoires et identifiés comme tels dans l’interface. Aucun formulaire métier, appel API, stockage de jeton ou transport Socket.IO n’est encore connecté.

## Installation et commandes

Utiliser Node 24 LTS (au moins 24.3) et npm, comme le backend. Depuis `mobile/` :

```sh
npm ci
npm run typecheck
npm test
npm start
```

`npm run web` ouvre la version navigateur de contrôle. `npm run android` demande un appareil ou un émulateur avec Expo Go compatible SDK 58. `npm run ios` nécessite un simulateur iOS sur macOS ; il ne fonctionne pas sur cet hôte Windows. Sur téléphone, utiliser le QR code du serveur avec une version compatible d’Expo Go et un accès réseau au poste. Une application de développement native pourra être préparée ultérieurement si nécessaire.

`npm run export:web` vérifie le bundle Web et produit `dist/`, ignoré par Git. `npm run test:watch` sert au développement. Ces commandes ne constituent pas un test sur appareil.

## Organisation

| Emplacement | Rôle |
|---|---|
| `app/_layout.tsx` | Safe area, barre de statut, fournisseur de session et navigation racine. |
| `app/(public)/` | Catalogue `/`, `/login`, `/register`, `/products/[id]`. |
| `app/(authenticated)/` | `/profile`, `/conversations`, `/conversations/[id]`. |
| `app/+not-found.tsx` | Destination inconnue et retour au catalogue. |
| `src/navigation/` | Garde de session et validation des identifiants de route. |
| `src/features/auth/` | État de préparation de session, erreur et nouvelle tentative. |
| `src/services/session.ts` | Interface de service indépendante des écrans ; adaptateur actuel toujours anonyme. |
| `src/components/` | Mise en page, texte, actions, chargement, erreur, état vide et nouvelle tentative. |
| `src/theme/` | Couleurs, espacements et apparence des navigateurs. |
| `src/tests/` | Tests Jest Expo et React Native Testing Library ; aucun test dans les routes. |

La garde `Stack.Protected` couvre tout le groupe authentifié et redirige vers `/login`. Aucun écran privé n’est monté pendant la préparation ou après une erreur de session. Le service actuel renvoie toujours `null`, sans session fictive ni bouton de contournement. Son remplacement par un service validant réellement une session serveur est nécessaire avant d’ouvrir les écrans privés. Les sessions injectées dans les tests sont uniquement des doubles.

Les identifiants de produit et de conversation doivent avoir la forme UUID. Cette validation de forme ne prouve ni l’existence de l’objet ni son autorisation. Le contrôle des permissions restera dans les services serveur.

Le catalogue reste public, conformément au cadrage. Les écrans privés sont regroupés dans `(authenticated)` plutôt que répartis dans `(main)` et une route racine : cela applique une garde commune, sans modifier leurs URL. Aucun schéma personnalisé ni domaine de liens universels n’est enregistré à cette étape ; ces choix restent à convenir avec l’équipe.

## Interface et accessibilité

Thème clair commun aux dispositions et aux composants. Les écrans utilisent une safe area et un contenu défilant de largeur limitée. Le texte conserve le redimensionnement système ; aucun nombre de lignes ne masque les libellés. Les actions font au moins 48 points de haut, ont un rôle et un nom accessibles, et les états de chargement et d’erreur disposent d’annonces adaptées. La vérification manuelle avec lecteur d’écran, clavier et grande police sur appareil reste à faire.

Le composant `RetryButton` ne déclenche que le callback fourni. Une erreur de préparation de session n’est retentée que sur demande. Aucun mécanisme de répétition réseau ni indicateur de connexion réseau simulé n’est ajouté.

## Versions et preuves

Les versions sont choisies selon la [matrice officielle Expo SDK](https://docs.expo.dev/versions/latest/), le [guide d’installation Router](https://docs.expo.dev/router/installation/) et les recommandations du fichier `bundledNativeModules.json` publié avec `expo@58.0.26`. La résolution exacte est conservée dans `package-lock.json`. Le backend garde ses propres dépendances et son lockfile.

- SDK 58 : React Native 0.88.1, React / React DOM 19.3.0 et React Native Web 0.21.4.
- Router 58.0.32, safe area 5.11.1 et screens 4.30.1 : versions recommandées par ce SDK.
- Jest 30, jest-expo 58 et React Native Testing Library 14 : combinaison indiquée par les [tests Expo](https://docs.expo.dev/develop/unit-testing/) et les [tests Router SDK 58](https://docs.expo.dev/router/reference/testing/). `@react-native/jest-preset` est requis par `jest-expo`.

Les modules de navigation, safe area, linking, constantes et barre de statut couvrent les besoins de cette étape. React DOM, React Native Web et le runtime Metro permettent les contrôles Web sur Windows. Axios, SecureStore, Socket.IO Client, schémas métier et bibliothèques d’interface supplémentaires sont reportés aux étapes qui les utiliseront.

Consulter le [relevé du socle](../docs/anas/socle-mobile.md) pour les vérifications réellement exécutées et les limites par plateforme. Les [contrats REST](../docs/anas/rest-mobile.md), [contrats temps réel](../docs/anas/messagerie-temps-reel.md) et [responsabilités Anas](../docs/responsibilities/Anas_HALLOUMI.md) restent les références métier.
