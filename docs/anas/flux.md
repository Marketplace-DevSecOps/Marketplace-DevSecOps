# Diagrammes des flux prévus

Statut **Prévu** pour les trois flux. Ils illustrent les [contrats REST](rest-mobile.md), le [contrat Socket.IO](messagerie-temps-reel.md) et l'[architecture](architecture.md). Les opérations métier représentées restent à implémenter et à tester. Les libellés de jetons désignent des catégories de données et ne contiennent aucune valeur secrète.

## 1. Connexion et renouvellement

```mermaid
sequenceDiagram
    participant UI as Écran mobile
    participant S as Service de session
    participant K as SecureStore
    participant API as API Express
    UI->>S: Connexion avec identifiants
    S->>API: POST /auth/mobile/login
    alt Identifiants refusés
        API-->>S: 401 UNAUTHORIZED
        S-->>UI: Erreur neutre
    else Session créée
        API-->>S: MobileSessionDto
        S->>K: Enregistrer le refresh
        alt Stockage réussi
            K-->>S: Confirmation
            S-->>UI: Accès en mémoire et session ouverte
        else Stockage en échec
            S->>API: Logout avec le nouveau refresh
            S-->>UI: Accès privé suspendu
        end
    end
    Note over S,API: Restauration au démarrage par refresh si jeton stocké
    UI->>S: Lecture protégée recevant 401
    S->>K: Lire le refresh courant
    K-->>S: Refresh disponible
    Note over UI,S: Les lectures concurrentes attendent le même refresh
    S->>API: POST /auth/mobile/refresh
    alt Rotation réussie et réponse reçue
        API-->>S: Nouvelle MobileSessionDto
        S->>K: Remplacer le refresh
        alt Écriture confirmée
            S->>API: Retenter la lecture une fois
            API-->>UI: Réponse validée
        else Écriture refusée
            S->>API: Tenter la révocation du nouveau refresh
            S-->>UI: Nettoyage et erreur de stockage
        end
    else Refus ou réponse perdue
        S->>K: Demander l'effacement
        S-->>UI: Nettoyage et retour à la connexion
    end
```

Le serveur réalise la rotation atomique et la révocation. Un refus ne déclenche pas de boucle de refresh. Le traitement des échecs de stockage et de réponse perdue suit le contrat proposé. Le résultat de toute révocation best effort reste à constater. La déconnexion ou le changement de compte pendant ces échanges invalide les callbacks de l'ancienne génération locale.

## 2. Conversation et envoi

```mermaid
sequenceDiagram
    participant M as Mobile acheteur
    participant API as REST Express
    participant RT as Socket.IO serveur
    participant DB as PostgreSQL
    participant W as Web vendeur
    Note over API,RT: Services métier et autorisations partagés
    M->>API: POST /conversations avec productId
    API->>DB: Vérifier produit et créer ou retrouver
    alt Produit refusé ou compte non autorisé
        API-->>M: Erreur neutre 401, 403 ou 404
    else Conversation autorisée
        DB-->>API: Conversation unique et participants
        API-->>M: 201 créée ou 200 retrouvée
        Note over M,RT: Écoute installée avant join
        M->>RT: conversation:join
        RT->>DB: Vérifier session et participation
        RT-->>M: Accusé avec lastMessageSeq
        M->>API: GET historique après le repère local
        API-->>M: Page de messages autorisés
        M->>RT: message:send avec clé stable et texte
        RT->>DB: Vérifier droits et traiter transaction
        alt Nouvelle clé
            DB-->>RT: Commit avec id, seq et date
            RT-->>M: Accusé avec MessageDto
            RT-->>M: message:created si abonné autorisé
            RT-->>W: message:created si abonné autorisé
        else Même clé et même demande
            DB-->>RT: Message canonique existant
            RT-->>M: Accusé identique sans nouvelle diffusion
        else Demande en conflit ou refusée
            RT-->>M: Accusé CONFLICT ou erreur neutre
        end
    end
```

Le diagramme suppose un handshake valide et un join accepté avant l'envoi. Tout refus de join arrête la branche d'abonnement. La création et la participation sont garanties transactionnellement côté service, en réutilisant les tables existantes. L'accusé et la diffusion peuvent arriver dans un ordre différent. Le secours `POST /conversations/:id/messages` utilise la même clé et le même service. Une panne après commit peut perdre la diffusion, la reprise REST assure alors le rattrapage.

## 3. Reconnexion et messages manquants

```mermaid
sequenceDiagram
    participant M as Coordinateur mobile
    participant S as Service de session
    participant RT as Socket.IO serveur
    participant API as Historique REST
    M->>M: Détecter coupure et figer le repère contigu
    M->>M: Attente progressive bornée avec aléa
    M->>S: Vérifier ou renouveler la session
    alt Session indisponible ou refusée
        S-->>M: Nettoyage et connexion requise
    else Session valide
        S-->>M: Accès courant en mémoire
        M->>RT: Handshake et écoute des messages
        RT-->>M: connect
        M->>RT: conversation:join après nouvelle autorisation
        alt Join refusé
            RT-->>M: Accusé NOT_FOUND ou UNAUTHORIZED
            M->>M: Arrêter la vue ou restaurer la session
        else Join accepté
            RT-->>M: lastMessageSeq cible
            Note over M,RT: Événements entrants mis en tampon borné
            M->>API: GET messages avec afterSeq contigu
            API-->>M: items et nextCursor
            M->>M: Fusionner la première page par id et seq
            loop Tant que nextCursor existe
                M->>API: GET messages avec cursor opaque
                API-->>M: Page suivante
                M->>M: Fusionner par id et ordonner par seq
            end
            M->>M: Fusionner le tampon
            M->>M: Réconcilier les envois et avancer le repère contigu
            alt Trou restant ou cible non atteinte
                M->>API: Nouvelle reprise bornée depuis le repère contigu
                API-->>M: Messages manquants ou erreur explicite
            else Historique rattrapé
                M->>M: Afficher l'état synchronisé
            end
        end
    end
```

Un échec de handshake retourne au traitement d'erreur de connexion et au budget de tentatives. Chaque page REST peut être refusée, y compris après un join réussi. Un 404 termine l'accès, un 401 passe par le service de session, un 429 suspend les reprises selon le délai fourni. Le contrôle périodique au premier plan et le retour d'arrière-plan couvrent aussi une diffusion perdue sans coupure visible. Une synchronisation réussie doit être prouvée par les identifiants et numéros persistés.
