# DevAgent (ex-DevPilot)

Ton tableau de bord de développeur, sur ton PC (http://localhost:5555) : tes projets et leurs
dépôts, les branches (carte dépôt → branche → main), les terminaux et sessions Claude qui
survivent aux redémarrages, l'aperçu local de chaque dépôt (« localhost:port ↗ »), les ports,
les serveurs, le nettoyage du disque.

## DevAgent : l'agent dans DevPilot

DevPilot s'appelle maintenant **DevAgent**. La commande `devpilot` marche toujours ; `devagent` est la même,
avec les commandes de l'agent en plus. Tes projets et leur dossier `.devpilot/` ne changent pas.

**Ce que l'agent fait.** Il connaît chaque projet (profil, besoins, feuille de route, dépôts), agit sur ses
connexions (GitHub, serveurs, hébergement, domaine, email, stockage, sauvegardes, déploiement) et automatise
ce qui se répète. Tout passe par **une seule liste d'outils** (`devagent outils`), avec trois niveaux :

| Niveau | Ce que ça veut dire |
|---|---|
| lecture | libre |
| ✎ écriture | faite, et écrite dans le journal |
| ⚠ irréversible | **jamais faite par l'agent** : elle attend ta confirmation (page *Confirmations* ou `devagent approuver <n>`) |

**Trois façons de s'en servir**

| Où | Comment | Coût |
|---|---|---|
| Dans Claude Code | `devagent mcp installer` une fois, puis dans n'importe quelle session : « où en est ce projet ? » | ton abonnement Claude Code |
| Dans l'interface | http://localhost:5555/agent → *Chat* (clé API Anthropic dans *Réglages*) | à l'usage, sur ta clé |
| Sans IA | *Automatisations* : sauvegarde de nuit, surveillance du site, certificat… | aucun |

**Les pages** (http://localhost:5555/agent) : Chat · Confirmations · Accès · Automatisations · Carte du
projet · Journal · Outils · Réglages.

**Les commandes**

| Je veux… | Commande |
|---|---|
| voir ce que l'agent sait faire | `devagent outils` |
| lancer un outil à la main | `devagent appeler projet_etat` (dans le dossier d'un projet) |
| voir ce que l'agent a fait | `devagent journal` |
| confirmer / refuser une action en attente | `devagent confirmations` · `devagent approuver 3` · `devagent refuser 3` |
| tout arrêter (l'agent ne fait plus que lire) | `devagent pause` · `devagent reprendre` |
| brancher l'agent dans Claude Code | `devagent mcp installer` · `devagent mcp etat` · `devagent mcp retirer` |
| les automatisations | `devagent auto lister` · `devagent auto activer <projet> <nom>` · `devagent auto historique` |
| l'état du coffre | `devagent coffre etat` |
| renommer le dossier `~/devpilot` en `~/devagent` | `devagent migrer` (simulation) · `devagent migrer --appliquer` · `devagent migrer --annuler --oui` |

**Renommer le dossier.** `devagent migrer` montre d'abord ce qu'il ferait. Il refuse tant que DevAgent est
lancé. Il renomme `~/devpilot` en `~/devagent` et **laisse `~/devpilot` comme lien** : les tâches cron, les
serveurs lancés, les montages Docker et tes scripts continuent de marcher avec l'ancien chemin. Il met à jour
la base, les commandes, le raccourci, le service, l'enregistrement dans Claude Code, et copie la mémoire de
Claude Code de chaque projet sous le nouveau chemin. Un PC neuf s'installe encore dans `~/devpilot`.

**Les automatisations.** Un fichier YAML par automatisation, dans le projet (`.devpilot/automations/`).
L'agent peut en proposer une ; **elle ne tourne que si tu l'actives**, et un fichier modifié redevient
inactif. Elles tournent tant que DevAgent est lancé. Le format est en tête de `devagent/automations.py`.

**Le coffre.** Les tokens et mots de passe sont chiffrés dans la base. La clé est le fichier
`~/.config/devagent/vault.key` : **garde-en une copie** avec tes autres clés (sans elle, les secrets sont à
ressaisir). Revenir à une version d'avant DevAgent : `devagent coffre ouvrir` d'abord (remet les secrets en clair).

**Les accès.** La page *Accès* range toutes les clés au même endroit : à quoi sert chaque plateforme, si la
clé est saisie, si elle marche vraiment, quand elle expire, et le lien pour la créer ou la renouveler. En
choisissant un projet, elle montre ce dont **ce projet** a besoin et ce qui manque. L'agent a les mêmes
informations (`acces_etat`, `acces_tester`, `projet_acces`), sans jamais voir une clé. Une clé ne se renouvelle
pas toute seule : l'automatisation `verifier-acces` te prévient quand l'une tombe ou expire bientôt.

**Le guide.** Dans la page *Chat*, le bouton « Que faire maintenant ? » fait lire à l'agent l'état réel du
projet (accès, dépôts, Vercel, domaine, automatisations) et rédige les prochaines actions, dans l'ordre, avec
ce qui bloque. Sans projet choisi : le point sur tous les projets. Il ne modifie rien. Deux automatisations
s'en servent : `point-du-matin` (un résumé envoyé chaque matin) et `surveillance-site-expliquee` (quand le site
tombe, l'agent cherche la cause et l'écrit dans l'alerte). Chaque appel utilise ta clé API Anthropic.

**À faire par toi.** Ce que l'agent ne peut pas faire lui-même (un accord à donner sur un site, une clé à
créer, une décision) est noté dans une liste, avec le lien exact ou la commande. DevAgent s'ouvre dessus quand
elle n'est pas vide, et le menu en affiche le nombre. Quand un outil peut constater que c'est fait, la ligne
est rayée toute seule (vérification toutes les 10 minutes, ou bouton « Vérifier maintenant »).

**Quand il manque un outil à l'agent**, il ne reste pas bloqué : il propose la commande exacte
(`commande_proposer`), que tu vois et confirmes ; elle tourne et il continue avec le résultat. Il note aussi le
manque (`outil_demander`) : la page *Outils* liste ces demandes, et « Construire avec Claude Code » ouvre Claude
dans le code de DevAgent avec la demande rédigée. Un nouvel outil n'est actif qu'après ta relecture et un
redémarrage. Une commande qui lirait une clé ou demanderait `sudo` n'est jamais proposée.

**Bitwarden : les clés sur tous tes PC.** Toutes les clés de la page *Accès* sont gardées dans une note de ton
Bitwarden (« DevAgent — acces »). Sur chaque PC, une seule fois : `devagent coffre connecter`. Ensuite :

| Je veux… | Commande (ou bouton de la page *Accès*) |
|---|---|
| mettre les clés de ce PC dans Bitwarden | `devagent coffre envoyer` |
| recevoir les clés sur un nouveau PC | `devagent coffre recuperer` |

Quand tu ajoutes ou renouvelles une clé dans la page *Accès*, DevAgent demande ton mot de passe maître et met
Bitwarden à jour. Le mot de passe n'est jamais gardé, et Bitwarden est reverrouillé après chaque opération.
L'agent n'a aucun outil pour lire cette note.

**Tes projets sur tous tes PC.** L'état de chaque projet (profil, feuille de route, serveurs, connexions,
automatisations, notes de session) est partagé par un dépôt GitHub **privé**, `devagent-etat`. Une fois par PC :
`devagent sync brancher`. Ensuite DevAgent synchronise tout seul toutes les 10 minutes (ou `devagent sync`).

- modifié ici seulement → envoyé ; modifié ailleurs seulement → reçu ;
- modifié sur deux PC → ce PC garde sa version, l'autre est posée à côté (`fichier.autre-pc`) et signalée ;
- un projet qui existe sur un autre PC est signalé : clone-le, il reçoit son état à la synchronisation suivante ;
- jamais envoyé : les clés (elles passent par Bitwarden), un fichier qui semble en contenir une, le résultat
  du dernier test SSH ; **une automatisation n'est active que sur le PC où tu l'as activée**.

**Un nouveau PC, en entier :** installer (`pc.sh`), `devagent coffre connecter`, `devagent coffre recuperer`,
`devagent sync brancher`, `devagent mcp installer`. Les clés sont en place et testées, et DevAgent sait où en
est chaque projet. Il reste à cloner les projets que tu veux sur ce PC.

**Vercel.** Avec le token du compte : `vercel_etat` (déploiements réussis ou en erreur, domaines, enregistrements
DNS que Vercel attend), `vercel_ajouter_domaine`, `vercel_redeployer` (après confirmation).

**Le DNS.** Avec tes accès Cloudflare, OVH ou Hostinger, `dns_plan` montre ce qui changerait et `dns_appliquer`
l'écrit après ta confirmation. Il ne supprime rien et ne remplace jamais des MX, SPF ou DMARC existants. Pour
un site sur Vercel, les enregistrements sont ceux que Vercel donne pour ce domaine.

**Où est le code**

| Quoi | Où |
|---|---|
| L'agent (outils, garde, coffre, automatisations, chat, MCP) | `devagent/` |
| Parler à une plateforme (notification, déploiement, DNS) | `devagent/connectors/` |
| La logique du tableau de bord, hors des routes | `system_ops.py`, `cloud_ops.py`, `hosting.py`, `projects.py`… |
| Les pages du tableau de bord | `templates/dash/pages/NN-nom.html` + `ui/js/NN-nom.js` + `ui/dashboard.css` |
| Les pages de l'agent | `devagent/web/pages/NN-nom.js` |
| Ce qui n'appartient qu'à un projet | `extensions/<nom>/` (ex. `extensions/proniver/`) |

**Ajouter une plateforme** = un fichier dans `devagent/connectors/` + ses outils dans `devagent/tools/`.
**Ajouter une page à l'agent** = un fichier dans `devagent/web/pages/`. **Ajouter une partie propre à un
projet** = un dossier dans `extensions/`. Les fichiers sont trouvés dans leur dossier : rien d'autre à modifier.

---

> **Perdu ? Une seule commande :** `devpilot pc` — l'assistant regarde où en est ce PC, te dit
> quoi faire et le fait (appuie sur **Entrée** pour le choix recommandé).

---

## Sommaire

1. [Les commandes à retenir](#1-les-commandes-à-retenir)
2. [PC vierge : installer DevPilot](#2-pc-vierge--installer-devpilot)
3. [Travailler sur un projet avec DevPilot](#3-travailler-sur-un-projet-avec-devpilot)
4. [Chaque jour : récupérer / publier DevPilot](#4-chaque-jour--récupérer--publier-devpilot)
5. [Préparer un PC pour publier](#5-préparer-un-pc-pour-publier)
6. [Ça ne marche pas ?](#6-ça-ne-marche-pas-)
   — et [vider ce PC](#vider-ce-pc-tout-effacer-pour-le-reconstruire-plus-tard)
7. [Pour développer DevPilot](#7-pour-développer-devpilot)

---

## 1. Les commandes à retenir

| Je veux… | Commande |
|---|---|
| savoir quoi faire sur ce PC | `devpilot pc` |
| lancer DevPilot | `devpilot` (ou l'icône DevPilot) |
| récupérer la dernière version publiée | `devpilot update` |
| publier ce que j'ai modifié (pour tous les PC) | `devpilot publish "ce que j'ai changé"` |
| comparer ce PC à GitHub | `devpilot version` |
| l'aide | `devpilot help` |
| vider ce PC de tout ce qui touche à DevPilot et aux projets | `devpilot effacer --simulation` puis `devpilot effacer` |

---

## 2. PC vierge : installer DevPilot

Ubuntu, connecté à internet. Copie-colle :

```bash
sudo apt update && sudo apt install -y git curl
bash <(curl -fsSL https://raw.githubusercontent.com/osarsar/devagent-app/main/pc.sh)
```

Il annonce « DevPilot n'est pas installé » → **Entrée** (installer), puis **Entrée** (le lancer).
DevPilot s'ouvre sur http://localhost:5555.

Ce qui est installé : le code dans `~/devpilot/.devpilot/app`, un environnement Python isolé
(`.venv`), la commande `devpilot`, l'icône dans le menu. Tes projets vivent dans
`~/devpilot/projects/`.

**Sessions persistantes (recommandé)** — les terminaux et sessions Claude survivent à un
redémarrage de DevPilot :

```bash
sudo apt install -y tmux
```

**Une ancienne installation** sans `devpilot pc` ? Même commande que ci-dessus (`bash <(curl …)`) :
l'assistant propose « Première mise à niveau ».

---

## 3. Travailler sur un projet avec DevPilot

Le chemin d'une modification, de l'idée à `main` — sans jamais toucher `main` directement :

```
main ──────────────●──────────   (ne change que par une fusion)
                   ↑ PR fusionnée
ta branche ──●──●──●             (tu y travailles, tu la pousses autant que tu veux)
```

### 1. Ouvrir le projet

**Projets** → ton projet (ou **+ Ajouter un projet**) → l'onglet **Développer** s'ouvre.
À gauche, **Dépôts** : tous les dépôts git du projet, même imbriqués, avec leur branche
actuelle et leur état (`2 modifiés`, `1 à pousser`, `● :5180` s'il tourne).

### 2. Choisir le dépôt et partir d'un main à jour

Clique le dépôt où tu vas travailler. Sa fiche s'ouvre en dessous.
Si elle dit « Ta copie de main a N commits de retard » → **Mettre main à jour**.

### 3. Créer ta branche — une par tâche

Dans **Branche**, tape un nom (ex. `feat/page-contact`, `fix/message-connexion`) → **Créer**.
Elle part toujours de `main` à jour sur GitHub. Si tu avais modifié des fichiers sur `main`
par erreur, coche « mettre de côté », ou crée la branche depuis la carte (étape 6) avec
« emporter mes modifications ».

### 4. Ouvrir ton outil, directement dans le dépôt

Sous **Ouvrir ici** :

| Bouton | Ce que ça ouvre |
|---|---|
| **✦ Claude** | une session Claude dans ce dépôt, en onglet à droite |
| **›_ Terminal** | un terminal dans ce dépôt, en onglet à droite |
| **VS Code** | le dépôt dans VS Code |
| **Fenêtre** / **✦ Claude fenêtre** | un terminal (ou Claude) dans une fenêtre séparée |

Les onglets au-dessus du terminal passent d'une session à l'autre ; **×** ferme une session.
Avec `tmux` installé, les sessions **survivent à un redémarrage de DevPilot** (Claude qui
travaille, un serveur de dev qui tourne…).

### 5. Voir tes modifications en direct

Dans la fiche du dépôt, **Voir en local** :

- rien ne tourne → **▶ Lancer** : un terminal s'ouvre au bon endroit et tape la commande
  (son `dev.sh`, la pile docker qui le monte, ou `npm run dev`) ;
- dès que ça répond → **localhost:port ouvrir ↗** ouvre la page dans un nouvel onglet ;
- **API :port** (gris) : une API utilisée par la page, pas à ouvrir (lien vers `/docs` si elle en a) ;
- **en rouge** « ne répond pas » : le port est ouvert mais le service a planté → **Voir les journaux**.

Tu modifies, tu enregistres, la page se met à jour (ou F5).

### 6. La carte des branches

**⎇ Carte des branches** (en haut de la liste des dépôts) : chaque dépôt → sa branche de
travail → `main`, avec des flèches :

- **bleu** : des commits à fusionner dans `main` ;
- **vert** : ce travail est déjà dans `main` (même après un « squash and merge ») ;
- **pointillé** : rien encore, ou pas de branche — bouton **Créer la branche** dans l'encadré.

Sur chaque branche : modifiée, jamais poussée, à pousser, sur GitHub, à récupérer (poussée
depuis un autre PC), la PR (ouverte / fusionnée), et les boutons Ouvrir / Terminal / Claude.

### 7. Sauvegarder ton travail, puis le fusionner

- **Sauvegarder** (autant que tu veux) : commit + push **sur ta branche**. Dans le terminal du
  dépôt : `git add -A && git commit -m "…" && git push -u origin HEAD` — ou l'outil Git de ton projet.
- **Terminé** : ouvre la **PR** vers `main`, fusionne-la. La carte passe au **vert**.
- **Mettre en production** : après la fusion, avec l'outil de déploiement de ton projet.

### 8. Reprendre plus tard, ou depuis un autre PC

- **Même PC** : rien à faire, le dépôt est resté sur ta branche.
- **Autre PC** : fiche du dépôt → liste **Branche** → ta branche (« sur GitHub ») →
  **Passer dessus**. Si elle y était déjà : `git pull` dans son terminal.
- **Branche fusionnée** : elle est finie. Pour la tâche suivante : **Mettre main à jour** →
  nouvelle branche.

### 9. Fermer proprement

- Barre **En marche** (en haut du projet) : chaque port ouvert ; **✕** arrête celui-là,
  **Fermer le projet** arrête tout (serveurs de dev, terminaux, console du projet) et libère les ports.
- Bouton **Console …** (si le projet a sa console) : ouvre toujours la version **à jour** —
  si son code a changé, il la relance d'abord.
- Page **Sessions** (menu de gauche) : toutes les sessions de tous les projets, pour les
  retrouver ou les fermer.

---

## 4. Chaque jour : récupérer / publier DevPilot

**Avant de travailler** (récupère ce qui a été publié depuis les autres PC) :

```bash
devpilot update
```

Il montre la branche de DevPilot et son état, avec le choix recommandé **★** (`main` si rien
n'est en cours, sinon il reste sur sa branche) : **Entrée** pour l'accepter, **c** pour choisir.

**Les dépôts de tes projets** : dans DevPilot, onglet **Développer** → **⇣ Mettre à jour** (ou
depuis la ⎇ Carte des branches) : chaque dépôt avec sa branche, le choix ★ pré-sélectionné, une
liste pour en choisir une autre (sur ce PC ou sur GitHub), **Appliquer**, puis le rapport dépôt
par dépôt. Jamais de « pull » à l'aveugle sur une vieille branche ; un dépôt avec des
modifications non commitées ne change pas de branche.

**Quand tu as modifié DevPilot** (publie pour tous les PC) :

```bash
devpilot publish "Carte des branches : flèches plus lisibles"
```

Ce que fait `publish`, dans l'ordre — et il **s'arrête au premier problème sans rien envoyer** :

1. vérifie : pas de secret (clé, jeton, `.env`), pas de données ni de sauvegardes, pas de
   **mot interdit** (ta liste privée, voir section 5), pas de marques de conflit `<<<<<<<` ;
2. lance les tests (~3 min ; `--sans-tests` pour une correction de texte) ;
3. commite sur une branche (jamais directement sur `main`) ;
4. se met à jour avec GitHub si un autre PC a publié entre-temps ;
5. pousse, ouvre la PR, la fusionne dans `main` ;
6. remet ce PC sur `main` et redémarre DevPilot.

**Le dépôt est PUBLIC** : tout ce qui part est lisible par tous, pour toujours. C'est pour ça
que `publish` vérifie autant.

**Fichiers nouveaux** (jamais suivis par git) : rien ne part sans ton choix. L'assistant demande
« Les publier aussi ? » (**Non** par défaut) ; en ligne de commande : `--avec-nouveaux` (les
publier) ou `--sans-nouveaux` (les laisser sur ce PC).

**Deux PC ont modifié les mêmes lignes ?** `publish` s'arrête, n'écrase rien, ne perd rien, et
te dit quoi taper. Corrige le fichier **sans laisser de `<<<<<<<`**, puis relance.

---

## 5. Préparer un PC pour publier

Seulement sur un PC où tu **développes** DevPilot (pas besoin pour `update`) :

```bash
devpilot pc
```

→ choisis **4 « Préparer ce PC pour publier »**. Il fait, en te guidant :

- installe et connecte `gh` (GitHub CLI) à ton compte ;
- crée une clé SSH si besoin et l'ajoute à ton compte GitHub ;
- te demande ta **liste de mots interdits** : les mots qui ne doivent **jamais** partir sur ce
  dépôt public (vraies adresses IP de tes serveurs, domaines de clients…), un par ligne.
  Elle reste sur le PC : `~/.config/devpilot/interdits.txt` — copie-la depuis un autre PC.

Vérifier :

```bash
gh auth status
ssh -T git@github.com        # doit répondre « Hi <ton compte>! »
```

---

## 6. Ça ne marche pas ?

| Symptôme | Que faire |
|---|---|
| Je ne sais pas où j'en suis | `devpilot pc` (Entrée = le choix recommandé) |
| DevPilot ne s'ouvre pas | `devpilot update` (le relance) ; sinon `tail -30 ~/devpilot/.devpilot/data/dashboard.log` |
| `update` : « modifications locales non publiées » | publie-les (`devpilot publish "…"`), ou mets-les de côté : `git -C ~/devpilot/.devpilot/app stash` |
| `update` : « main locale a des commits absents de GitHub » | voir : `git -C ~/devpilot/.devpilot/app log --oneline origin/main..main` — puis décide avant de jeter |
| `publish` : « fichiers NOUVEAUX » | choisis `--avec-nouveaux` ou `--sans-nouveaux` (ou ajoute-les à `.gitignore`) |
| `publish` : « REFUS » | un secret, une donnée ou un mot interdit allait partir : retire-le, relance |
| `publish` : « tests en échec » | lis la fin de `/tmp/devpilot-publish-tests.log`, corrige, relance |
| `publish` : « mêmes lignes qu'une publication d'un autre PC » | suis les commandes affichées ; ne laisse jamais de `<<<<<<<` |
| `publish` : « push refusé » / « gh n'est pas connecté » | `devpilot pc` → 4 |
| Les terminaux disparaissent au redémarrage | `sudo apt install -y tmux`, puis `devpilot update` |
| Un port reste occupé après avoir fermé un projet | dans le projet : barre « En marche » → ✕ sur le port, ou « Fermer le projet » |

---

### Vider ce PC (tout effacer, pour le reconstruire plus tard)

DevPilot est fait pour que tout soit dans le cloud (GitHub, coffre, sauvegardes) : ce PC peut
redevenir vierge, puis être reconstruit (section 2). **Depuis un terminal normal** (pas un
terminal DevPilot) :

```bash
devpilot effacer --simulation     # montre tout ce qui serait fait — n'efface RIEN
devpilot effacer                  # pour de vrai
```

1. **Inventaire** : chaque projet (taille, dépôts), son Docker (conteneurs, volumes = bases
   locales, images construites), ses liens et raccourcis, DevPilot lui-même (programme,
   données, commande, icône, service), les clés créées par DevPilot ; plus ce que chaque projet
   déclare avoir installé ailleurs (fichier `effacer-poste.sh` d'un de ses dépôts).
2. **Le travail qui n'est QUE sur ce PC** est signalé dépôt par dépôt (fichiers non commités,
   commits jamais poussés, stash) : ce projet n'est **jamais** coché par défaut. Une branche
   déjà fusionnée par une PR n'est pas comptée.
3. **Tu choisis** : « tout » (il redemande seulement pour le travail non sauvegardé et les
   secrets) ou élément par élément.
4. **Avant d'effacer** : sauvegarde chiffrée des données DevPilot (`~/devpilot-donnees-….tar.gz.gpg`,
   garde-la), et les actions déclarées par les projets (sauvegardes, retrait des clés…).
5. **Confirmation tapée** (`EFFACER <nom-du-pc>`), puis effacement et journal.

Jamais touché : tes autres clés (`~/.ssh/id_*`), `~/.gitconfig`, docker lui-même, les paquets
(tmux, gh…), tes fichiers hors projets, et rien hors de ton dossier personnel. Les secrets
sont écrasés avant d'être effacés. Les copies dans le cloud restent intactes.

---

## 7. Pour développer DevPilot

```bash
cd ~/devpilot/.devpilot/app
.venv/bin/python -m pytest -q          # les tests (~3 min)
DEVPILOT_PORT=5566 .venv/bin/python dashboard.py   # une 2ᵉ instance pour tester, sans arrêter la tienne
```

- `dashboard.py` (Flask) + `templates/dashboard.html` (l'interface, un seul fichier — c'est un
  gabarit Jinja : ne jamais écrire `{{` dans son JavaScript).
- `dev.py` (dépôts, branches, carte), `preview.py` (aperçu local), `persist.py` (sessions tmux),
  `ports.py`, `controller.py` (la console d'un projet), `servers.py`, `sshaccess.py`.
- `publish.sh`, `update.sh`, `pc.sh`, `effacer.py` : les commandes `devpilot publish / update / pc / effacer`.
- On publie avec `devpilot publish` : branche → PR → fusion, jamais de push direct sur `main`.
