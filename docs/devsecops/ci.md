# CI — correctif du 25 novembre 2026

Ce correctif traite les échecs constatés au commit fed7a7f : variables Compose absentes, workflow CD vide, référence d’image Trivy incorrecte et configuration SonarQube incomplète. Les applications et leurs contrats métier ne changent pas.

## Contrôles exécutés par le workflow

| Job | Travail |
|---|---|
| build-test-security | Préparation de la configuration locale fictive du runner, validation Compose, construction de l’image, démarrage des bases isolées, migrations de test, types et tests backend, puis scan Trivy. |
| mobile | Node 24, installation selon le lockfile npm sans scripts natifs, types, tests Jest et export Web Expo en mode réel. |
| sonarqube | Analyse et quality gate uniquement lorsque le service externe optionnel est configuré. Sinon, avertissement explicite et mention NOT RUN dans le résumé. |

Les événements push et pull_request ciblent develop, staging et production. workflow_dispatch permet une relance manuelle. Les permissions sont limitées à contents:read et les identifiants du checkout ne sont pas conservés. Les exécutions obsolètes sur la même branche sont annulées.

## Configuration Compose

Sur le runner éphémère, avant toute commande Docker :

~~~sh
cp backend/.env.example .env
cp backend/.env.example backend/.env
docker compose config --quiet
~~~

Le .env racine fournit les variables d’interpolation PostgreSQL. backend/.env satisfait le env_file existant. Ces deux fichiers utilisent exclusivement les exemples locaux publics et ne sont ni commités, ni publiés en artefacts. Le contexte Docker exclut les fichiers .env, dépendances locales, caches de compilation et client Prisma généré sur le poste ; le client est généré dans l’image Linux.

Les deux bases sont propres au runner et attendues avec --wait. Le script npm run test:db refuse une base de test absente ou identique à la base principale avant de réappliquer les migrations. Il ne faut jamais exécuter ce script contre une base contenant des données à conserver. La CI définit NODE_ENV=test pour ces commandes.

Le nom de projet Compose marketplace est fixé dans le job : l’image construite est marketplace-backend:latest. Trivy scanne cette image locale et conserve exit-code:1 pour HIGH/CRITICAL, sans continue-on-error ni exclusion générale des vulnérabilités. Son rapport est publié même en cas de résultat bloquant. L’absence de rapport produit un avertissement et ne transforme pas l’étape de scan en réussite.

Le nettoyage always supprime les conteneurs et volumes du projet isolé du runner, puis les deux fichiers d’environnement temporaires.

## SonarQube optionnel

SonarQube est optionnel dans docs/responsibilities/Abdelillah_ERRAGUIBI.md. Les autres contrôles restent obligatoires. Pour activer l’analyse, configurer dans les paramètres GitHub Actions du dépôt :

| Paramètre | Emplacement |
|---|---|
| SONAR_TOKEN | Secret Actions, jeton autorisé pour le projet Sonar réel. |
| SONAR_HOST_URL | Secret Actions, URL du service Sonar joignable depuis le runner. |
| SONAR_PROJECT_KEY | Variable Actions, clé exacte du projet Sonar. |
| SONAR_ORGANIZATION | Variable Actions si le service SonarQube Cloud l’exige. |

Aucun compte ni projet Sonar n’est créé automatiquement. Si les trois paramètres requis sont absents, le workflow signale que l’analyse n’a pas été exécutée. Si la configuration est partielle ou les identifiants publics mal formés, le job échoue avec un diagnostic explicite. Lorsqu’elle est configurée, l’analyse et son quality gate sont bloquants.

sonar-project.properties déclare les sources et tests réellement présents. Le client Prisma généré et les tests mobiles sont exclus des sources pour éviter un double classement. Aucun rapport de couverture absent n’est annoncé. Les secrets ne sont injectés que dans les étapes Sonar et ne sont pas accessibles aux étapes de tests des applications.

## Workflow CD vide

Le fichier .github/workflows/cd.yml avait une taille de zéro octet et provoquait un échec de validation GitHub Actions. Il est retiré. Aucun déploiement n’est simulé ; une future livraison demandera une cible, des identifiants, un environnement et une politique de promotion définis avec Abdelilah.

## Vérifications locales

- Génération du client Prisma 7.10.1 : réussie.
- Contrôle des types et compilation backend : réussis.
- Backend : 14 fichiers de tests, 99 tests réussis, hors validation de migrations PostgreSQL réelle.
- Docker Compose : configuration complète validée à partir de copies isolées des exemples, sans modifier les fichiers .env du poste.
- actionlint 1.7.12 : workflow valide ; binaire officiel vérifié par SHA-256. ShellCheck et Pyflakes ne sont pas utilisés dans ce contrôle local.
- Mobile : types, 57 tests sur 6 suites et export Web de 902 modules réussis avec les variables du job CI.

Le moteur Docker local reste inaccessible après la commande de démarrage de Docker Desktop. La construction Linux, les migrations contre PostgreSQL et Trivy ne sont donc pas déclarés exécutés ici. SonarQube nécessite son service réel configuré. La validation finale de ces étapes doit provenir du run GitHub Actions du commit publié.

## Sources officielles

- Interpolation Compose : https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Image construite par Compose : https://docs.docker.com/reference/cli/docker/compose/build/
- Attente des services : https://docs.docker.com/reference/cli/docker/compose/up/
- Trivy Action : https://github.com/aquasecurity/trivy-action
- SonarQube Action : https://github.com/SonarSource/sonarqube-scan-action
- actionlint : https://github.com/rhysd/actionlint
