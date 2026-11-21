# Plan — de DevPilot à DevAgent

Écrit le 2026-11-20, à partir du code réel de `~/devpilot/.devpilot/app`.

## Etat au 2026-11-20 — ce qui est construit

Branche `feat/devagent`.

| Phase | Etat | Ou |
|---|---|---|
| 0 Cadrer | Fait | fin de ce fichier |
| 1 Couche d'outils | Fait : une centaine d'outils en 12 domaines. La logique est sortie des routes : `cloud_routes.py` n'a plus aucune route de plus de 30 lignes ; dans `dashboard.py` il ne reste que les terminaux et la console (de l'interface pure) | `devagent/registry.py`, `devagent/tools/`, `system_ops.py`, `cloud_ops.py`, `hosting.py` |
| 2 Coffre, journal, garde | Fait. Les 2 routes qui renvoyaient un secret sont supprimees ; les boutons classiques sont journalises | `devagent/vault.py`, `journal.py`, `guard.py` |
| 3 Serveur MCP | Fait, branche dans Claude Code, teste avec une vraie session | `devagent/mcp_server.py` |
| 4 Automatisations | Fait : horaire, intervalle, nouveau commit sur GitHub, webhook local, manuel ; 5 modeles | `devagent/automations.py` |
| 5 Chat integre | Fait, teste avec un modele simule et avec une vraie cle API | `devagent/chat.py` |
| 6 Carte et interface | Fait. `dashboard.html` est decoupe : 12 pages, 18 scripts, 1 feuille de style ; Proniver est une extension | `templates/dash/`, `ui/`, `extensions/proniver/`, `devagent/carte.py`, `devagent/web/` |
| 7 Connecteurs | Notification (Telegram, email), deploiement SSH, DNS (Cloudflare, OVH, Hostinger) | `devagent/connectors/` |
| 8 Nom | Commande `devagent`, interface, README, depot GitHub renomme, migration du dossier prete | `install.sh`, `paths.py`, `devagent/migrate.py` |

Reste, et pourquoi :
- **DNS** : Cloudflare, OVH et Hostinger sont ecrits d'apres leurs descriptions d'API et testes sur des
  reponses simulees ; aucun n'a encore ete essaye sur un vrai compte.
- **Webhook GitHub entrant** : DevAgent n'ecoute que sur ce PC. Le declencheur `depot` le remplace (il regarde
  GitHub toutes les 5 minutes).
- **Dossier** : le depot GitHub est renomme (`osarsar/devagent-app`) et, sur ce PC, le dossier est
  `~/devagent` depuis le 2026-11-21 (`devagent migrer`) ; `~/devpilot` reste comme lien. Les deux lignes du
  crontab gardent l'ancien chemin, qui marche par le lien. Sur un autre PC : `devagent migrer --appliquer`.
- **Chat integre** : essaye pour de vrai le 2026-11-21 (deux questions sur un projet, trois appels d'outils, reponses justes).
- **Publication** : branche poussee, pull request n° 18 ouverte vers `main` ; a fusionner par toi.

Comment le decoupage de `dashboard.html` a ete verifie : un navigateur pilote visite les 12 pages et les
8 onglets d'un projet et releve les erreurs JavaScript — 0 avant, 0 apres, memes pages, memes onglets.

## 1. Le besoin

> Un agent IA qui organise mon travail, projet par projet. Chaque projet est lié aux
> plateformes dont il a besoin (GitHub, stockage, nom de domaine, serveur…). Je lui parle,
> il sait où en est le projet, il fait les actions, et il automatise ce qui se répète,
> comme n8n.

Cela fait quatre capacités :

| # | Capacité | Exemple |
|---|---|---|
| 1 | **Connaître** chaque projet | « Où en est hassouniprotrans ? Que manque-t-il pour la mise en ligne ? » |
| 2 | **Agir** sur les plateformes liées | « Crée le dépôt, le bucket, fais pointer le domaine sur le serveur » |
| 3 | **Automatiser** (le côté n8n) | « Chaque nuit, sauvegarde la base. Si le site tombe, préviens-moi » |
| 4 | **Montrer** | Une carte de chaque projet : ses services, ses connexions, leur état |

## 2. Ce que DevPilot fait déjà

16 600 lignes de Python (Flask + SQLite), 23 fichiers de tests, 208 routes API.

| Capacité | État aujourd'hui | Où |
|---|---|---|
| 1. Connaître | **Fait.** Profils, besoins, phases, feuille de route, dépôts, branches, ports | `model.py`, `phases.py`, `dev.py`, `ghorg.py`, `preview.py` |
| 2. Agir | **Fait à 70 %.** GitHub, R2, serveurs SSH, hébergeurs, vérification DNS / MX / HTTPS | `github_ops.py`, `cloudflare_r2.py`, `servers.py`, `sshaccess.py`, `dnscheck.py` |
| 3. Automatiser | **Absent.** Aucun planificateur, aucun déclencheur, aucun workflow | — |
| 4. Montrer | **Partiel.** Feuille de route et carte des branches ; pas de carte des services | `dashboard.html` |
| L'agent | **Absent.** DevPilot ouvre Claude dans un terminal et écrit un `CLAUDE.md`. Claude ne peut appeler aucune fonction de DevPilot | `dev.py`, `persist.py` |

**Conclusion : ne pas tout reconstruire.** Les mains existent (les intégrations) et les règles de
sécurité aussi (rien n'est effacé sans inspection, sauvegarde avant, confirmation tapée). Il manque
le cerveau, le planificateur, et une couche propre entre les deux.

## 3. Les quatre problèmes à corriger d'abord

1. **Les actions sont collées aux routes HTTP.** `cloud_routes.py` (1 440 lignes) mélange logique
   et HTTP. Un agent ne peut pas appeler une action proprement.
2. **Les secrets sont en clair.** Le token GitHub et les tokens d'hébergeurs sont dans la table
   `settings` de SQLite, et `/api/hosting/accounts/<id>/token` les renvoie tels quels. Un agent ne
   doit jamais voir un secret.
3. **Aucun journal des actions.** Avec un agent qui agit seul, il faut savoir qui a fait quoi et quand.
4. **L'interface est un seul fichier de 617 Ko** (`templates/dashboard.html`) et `dashboard.py`
   fait 2 872 lignes. Ajouter une page y est difficile.

## 4. L'architecture cible

```
        TOI ── chat ──┐                       Claude Code (dans un projet)
                      ▼                                  │
              ┌──────────────┐                           │ MCP
              │    AGENT     │  boucle Claude            │
              └──────┬───────┘                           │
                     ▼                                   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  OUTILS  (une seule liste, typée, testée)                   │
   │  projet.etat · github.creer_depot · r2.creer_bucket ·       │
   │  dns.verifier · serveur.deployer · sauvegarde.lancer …      │
   ├─────────────────────────────────────────────────────────────┤
   │  GARDE : niveau de risque → confirmation · journal · coffre │
   └───────┬─────────────────────────────────────────┬───────────┘
           ▼                                         ▲
   CONNECTEURS (GitHub, R2, SSH,            AUTOMATISATIONS
   DNS, Vercel, OVH, e-mail…)               déclencheur → étapes
                                            (horaire, webhook, événement)
```

Trois règles tiennent tout :

- **Une seule liste d'outils.** Le chat, Claude Code, les automatisations et les boutons de
  l'interface appellent les mêmes outils. Ajouter une plateforme = écrire un connecteur et
  déclarer ses outils, rien d'autre.
- **Chaque outil a un niveau de risque.** `lecture` (libre) · `écriture` (journalisé) ·
  `irréversible` (confirmation de ta part à chaque fois : supprimer, DNS, mot de passe, prod).
- **L'agent ne voit jamais un secret.** L'outil reçoit le nom du compte, le coffre fournit la
  valeur au moment de l'appel.

### Le choix technique pour l'agent

L'agent doit agir sur **ton PC** (dossiers, clés SSH, Docker). Il tourne donc dans DevPilot, pas
chez un hébergeur d'agents.

| Usage | Technique | Coût |
|---|---|---|
| Depuis une session Claude Code d'un projet | Serveur **MCP** de DevAgent | Aucun en plus : ton abonnement Claude Code |
| Chat dans l'interface DevAgent | SDK Python `anthropic`, boucle d'outils (Tool Runner), modèle `claude-opus-5-5` | Clé API, payée au token |
| Automatisations | Moteur interne. **Pas d'IA** dans les étapes fixes ; l'agent seulement pour un diagnostic | Presque nul |

Le serveur MCP vient en premier : il donne un agent utile sans nouvelle dépense, et il oblige à
construire la liste d'outils proprement.

## 5. Les étapes

Chaque phase laisse DevPilot utilisable et les tests verts.

### Phase 0 — Cadrer (2 jours)
- Écrire 10 scénarios réels : ce que tu veux dire à l'agent, et ce qu'il doit faire.
- Classer chaque action existante en `lecture` / `écriture` / `irréversible`.
- **Fini quand :** les 10 scénarios sont écrits, chacun avec la liste des outils qu'il demande.

### Phase 1 — La couche d'outils (1 à 2 semaines)
- Sortir la logique de `cloud_routes.py` et `dashboard.py` vers des modules par domaine.
- Créer `tools/` : un registre où chaque outil a un nom, une description, un schéma d'entrée, un
  niveau de risque et une fonction. Les routes HTTP deviennent de simples appels au registre.
- **Fini quand :** les 23 fichiers de tests passent, et une commande liste tous les outils.

### Phase 2 — Coffre, journal, garde (1 semaine)
- Coffre : secrets chiffrés (trousseau du système), migration des tokens hors de `settings`,
  suppression de la route qui renvoie un token.
- Journal : table `actions` (qui, outil, arguments sans secret, résultat, date).
- Garde : un outil `irréversible` ne s'exécute jamais sans ta confirmation.
- **Fini quand :** plus aucun secret lisible dans `devpilot.db`, et chaque appel d'outil laisse une ligne.

### Phase 3 — Serveur MCP : le premier agent (1 semaine)
- Exposer le registre en MCP. Chaque session Claude ouverte par DevPilot le reçoit automatiquement.
- Remplace la consigne actuelle du `CLAUDE.md` (« écris dans `connections.json` »).
- **Fini quand :** dans une session Claude d'un projet, « crée le dépôt GitHub et lie-le au projet »
  marche de bout en bout, avec confirmation pour ce qui est risqué.

### Phase 4 — Automatisations : le côté n8n (2 semaines)
- Modèle : un **déclencheur** (horaire, webhook GitHub, changement d'état, site qui ne répond plus)
  puis des **étapes** (appels d'outils), stockées en YAML dans `.devpilot/automations/` du projet.
- Moteur : planificateur, reprises, historique des exécutions, arrêt d'urgence.
- Trois modèles prêts : sauvegarde nocturne, surveillance du site, alerte de fin de certificat.
- **Fini quand :** la sauvegarde nocturne tourne 7 jours de suite sur un vrai projet.

### Phase 5 — Chat dans l'interface (1 à 2 semaines)
- Panneau de chat par projet : boucle d'outils sur le même registre, confirmation dans l'interface.
- L'agent peut **proposer** une automatisation ; tu la valides avant qu'elle soit active.
- **Fini quand :** les 10 scénarios de la phase 0 passent.

### Phase 6 — Carte du projet et interface (2 semaines)
- Découper `dashboard.html` en pages et composants.
- Carte par projet : services, connexions, état, générée depuis les données (pour MarocDefender,
  depuis `services.json`).
- **Fini quand :** chaque projet a sa carte, et ajouter une page ne touche qu'un fichier.

### Phase 7 — Nouveaux connecteurs (à la demande)
- Un connecteur par besoin réel : API DNS (Cloudflare, OVH), déploiement Vercel / Netlify, e-mail.
- **Fini quand :** un connecteur s'ajoute en un fichier et ses tests.

### Phase 8 — Le nom DevAgent (2 jours, en dernier)
- Le nom est partout : dossier `~/devpilot`, `.devpilot/` dans chaque projet, commande `devpilot`,
  dépôt `devpilot-app`, marqueurs dans les `CLAUDE.md`.
- Renommer la commande, l'interface et le dépôt ; garder `.devpilot/` lisible pour que les projets
  existants continuent de marcher.

**Total : environ 10 à 12 semaines** de travail, estimation à revoir après la phase 1.

## 6. Ce qu'on ne fait pas

- **Pas d'éditeur visuel de workflows** comme n8n. C'est des mois de travail ; un fichier YAML
  que l'agent écrit pour toi donne le même résultat.
- **Pas d'agent autonome sur la prod.** Il propose, tu confirmes.
- **Pas de reconstruction de zéro.** On garde les intégrations et les tests.

## 7. Décisions à prendre

| Décision | Recommandation |
|---|---|
| Reconstruire ou restructurer ? | Restructurer |
| Par quoi commencer ? | Phases 0 à 3 : un agent utile en 3 à 4 semaines, sans nouveau coût |
| Chat intégré (clé API payante) ? | Décider après la phase 3 |
| Renommer en DevAgent ? | Oui, mais en dernier |

---

# Phase 0 — résultat (2026-11-20)

## A. Inventaire : 208 routes, regroupées en outils

Niveaux : **L** lecture (libre) · **E** écriture (journalisée) · **I** irréversible (confirmation à chaque fois).

| Domaine | Outils en lecture (L) | Outils en écriture (E) | Outils irréversibles (I) |
|---|---|---|---|
| **projet** | lister, état complet, besoins, feuille de route, inspecter | créer, importer, modifier, définir le profil, marquer une étape, sauver une note de session | supprimer, purger, déplacer, renommer, nettoyer |
| **git** | statut, journal, comparer, branches, PR ouvertes | nouvelle branche, changer de branche, commit, pull, stash, synchroniser, push (jamais `main`) | réconcilier dossier ↔ dépôt, abandonner une fusion |
| **github** | dépôts, branches, commits, vue de l'organisation | créer un dépôt, cloner, lier au projet, tout mettre à jour | — |
| **stockage** (R2) | tester, lister buckets et objets | créer un bucket, envoyer, télécharger, lien temporaire | supprimer des objets |
| **sauvegarde** | historique, état de synchro | lancer une sauvegarde, synchroniser | restaurer (écrase l'existant) |
| **serveur** | lister, tester, clés SSH disponibles | ajouter, modifier, générer une clé | changer le mot de passe / l'accès, supprimer |
| **hébergement** | comptes (tokens masqués) | lier un projet à un compte | supprimer un compte |
| **domaine / e-mail** | lire, vérifier DNS, MX, HTTPS | enregistrer le domaine, le fournisseur d'e-mail | — |
| **exécution** | ports, processus, Docker, aperçus, ce qui tourne | démarrer / arrêter la console, arrêter un port ou un projet, ouvrir une session | — |
| **PC** | caches, tailles, téléchargements | — | nettoyer |

Cela donne environ **55 outils** pour 208 routes.

### Ce que l'agent ne reçoit pas
- `/api/hosting/accounts/<id>/token` et `/api/settings/raw/<key>` : renvoient un secret en clair. À supprimer en phase 2.
- `/api/terminal/exec` : exécute n'importe quelle commande. Hors de la liste d'outils ; l'agent passe par des outils précis.
- La saisie d'un secret (token, mot de passe) : toujours par toi, dans l'interface.

### Ce qui n'est pas à sa place
- **18 routes `/api/proniver/*`** (générateur de documents d'un seul projet) sont dans le cœur de l'application. À sortir en extension de projet : c'est le premier exemple de « partie propre à un projet ».

## B. Dix scénarios (brouillon, à corriger par toi)

| # | Tu dis | Outils appelés | Manque aujourd'hui |
|---|---|---|---|
| 1 | « Où en est ce projet ? Que reste-t-il avant la mise en ligne ? » | projet.état, feuille de route, domaine.vérifier | — |
| 2 | « Crée un projet vitrine pour le client X avec son dépôt GitHub » | projet.créer, github.créer_dépôt, github.lier | — |
| 3 | « Prépare un bucket pour les médias de ce projet » | stockage.créer_bucket, projet.modifier | — |
| 4 | « Le client a acheté monsite.ma : quels DNS mettre ? Puis vérifie » | domaine.enregistrer, domaine.vérifier | Écrire le DNS par API (aujourd'hui : vérification seule) |
| 5 | « Ajoute le serveur OVH reçu ce matin et installe ma clé » | serveur.ajouter, serveur.accès (I), serveur.tester | — |
| 6 | « Sauvegarde ce projet chaque nuit à 3 h » | sauvegarde.lancer | **Planificateur** |
| 7 | « Qu'est-ce qui tourne sur mon PC ? Arrête tout sauf marocdefender » | exécution.ce_qui_tourne, exécution.arrêter | — |
| 8 | « Mets à jour tous les dépôts et dis-moi ce qui n'est pas poussé » | github.tout_mettre_à_jour, git.statut | — |
| 9 | « Préviens-moi si un site client tombe ou si un certificat expire » | domaine.vérifier | **Planificateur**, **notification** (Telegram ou e-mail) |
| 10 | « Déploie la dernière version sur le serveur » | — | **Outil de déploiement** (aujourd'hui l'étape est cochée à la main) |

## C. Ce que la phase 0 change au plan

- 7 scénarios sur 10 marchent avec les outils existants : les phases 1 à 3 suffisent pour eux.
- Trois manques réels : **planificateur** (phase 4), **notification** et **déploiement** (deux connecteurs à avancer de la phase 7 vers la phase 4).
- Ajouter à la phase 1 : sortir Proniver du cœur.
