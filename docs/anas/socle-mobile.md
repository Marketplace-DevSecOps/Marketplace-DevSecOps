# Relevé du socle mobile

Étape du 25 novembre 2026, sur la base du commit `745a9f5`. Les modifications de cette étape ne sont pas encore commitées. Le périmètre est `mobile/` et la documentation Anas ; backend, Prisma, Docker et workflows restent inchangés.

## Réalisation

- Projet autonome dans `mobile/`, avec npm et son `package-lock.json`, sans ajout de workspace racine.
- Expo SDK 58.0.26, React Native 0.88.1, React 19.3.0, Expo Router 58.0.32, TypeScript 6.0.3. Versions choisies après consultation des sources officielles puis recoupées avec `expo@58.0.26/bundledNativeModules.json`.
- Routes publiques pour catalogue, connexion, inscription et produit ; groupe privé pour profil, conversations et conversation. La garde commune redirige l’utilisateur anonyme vers `/login` et bloque la navigation pendant la préparation ou une erreur de session.
- Écrans provisoires sans données métier ni faux succès ; fallback pour destination inconnue et contrôle de forme UUID sur les routes à identifiant.
- Safe areas, contenu défilant, thème commun, texte adaptable, actions d’au moins 48 points, noms/rôles accessibles, états de chargement, erreur, vide et nouvelle tentative.
- Interface de service de session séparée de React. L’adaptateur de cette étape renvoie uniquement un visiteur anonyme ; il ne lit et n’écrit aucun jeton et ne contacte aucun endpoint.
- Jest 30.5.2, preset `jest-expo` 58.0.15 et React Native Testing Library 14.1.0. Tests hors de `app/`, avec double des insets natifs ; aucune preuve de safe area native n’est déduite des tests.

Le regroupement `(authenticated)` remplace l’emplacement prévisionnel `(main)` pour les routes privées, sans changer leurs chemins publics. Le catalogue reste public dans `(public)/index.tsx`. Les tests qui ouvrent des écrans privés injectent explicitement une session fictive ; aucun tel accès n’est proposé dans l’application livrée.

## Vérifications de cette étape

Le relevé initial avait été interrompu par une déconnexion de l’environnement. L’étape suivante [client API mobile](client-api-mobile.md) a exécuté avec succès les 10 tests existants du socle, au sein des 57 tests complets, ainsi que le contrôle des types et l’export Web. Il s’agit de tests en simulation et de génération de bundle ; aucun essai sur appareil ni démarrage visuel de navigateur n’est revendiqué.

Environnement constaté : Windows, Node 24.18.0 et npm 11.16.0. Le SDK Android et Android Studio sont présents. `adb devices -l` ne liste aucun appareil et `emulator -list-avds` ne liste aucun AVD. Aucun appareil Android ni simulateur iOS n’est donc utilisé à cette étape.

L’installation a rencontré des erreurs `EPERM` lors de créations concurrentes de dossiers par npm. Une nouvelle installation locale utilise `UV_THREADPOOL_SIZE=1`, sans changement de configuration globale ni de dépendance du backend. Les scripts de cycle d’installation ont été désactivés pour ce contrôle ; aucun build natif n’est réalisé.

## Limites et suite

MOB-03, MOB-08 et MOB-09 disposent d’un socle partiel. Cela ne valide pas leur fonctionnalité complète : retour après authentification, expiration/révocation, connectivité, cycle de vie, formulaires, clavier et aides d’accessibilité nécessitent leurs implémentations et des essais adaptés. Les autres MOB et tous les MSG restent prévisionnels.

Mohamed fournit les services réels de compte, session, profil et consultation. L’adaptateur `SessionService` devra être remplacé lors de l’intégration compte, avec SecureStore et validation des réponses convenus. Hanane conserve l’application Web et la consommation commune des contrats. Abdelilah conserve la pipeline ; les commandes mobiles documentées pourront lui servir à une intégration ultérieure. Aucun schéma partagé ni module backend n’est ajouté ici.

Les contrats [REST](rest-mobile.md) et [Socket.IO](messagerie-temps-reel.md) restent inchangés et soumis aux décisions d’intégration déjà identifiées. La publication d’annonces mobile, l’assistant IA et les fonctionnalités optionnelles ne sont pas implémentés.

## Sources officielles consultées

Consultation le 25 novembre 2026 :

- [Matrice de compatibilité Expo SDK](https://docs.expo.dev/versions/latest/) : SDK 58, React Native 0.88, React 19.3 et minimum Node 22.13 ; Node 24.18 du poste est compatible.
- [Installation Expo Router](https://docs.expo.dev/router/installation/) : entrée `expo-router/entry`, plugin, dépendances natives et Web, installation selon le SDK.
- [Routes protégées](https://docs.expo.dev/router/advanced/protected/) : garde par groupe et `redirectTo` disponible à partir du SDK 58.
- [Tests unitaires Expo](https://docs.expo.dev/develop/unit-testing/) : preset Jest adapté aux modules natifs.
- [Tests Expo Router](https://docs.expo.dev/router/reference/testing/) : Testing Library 14 au minimum pour SDK 58, API asynchrone et tests hors des routes.
- [API safe area SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/safe-area-context/) et [screens SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/screens/) : versions natives recommandées.

Les commandes d’usage et l’organisation détaillée figurent dans le [README mobile](../../mobile/README.md).
