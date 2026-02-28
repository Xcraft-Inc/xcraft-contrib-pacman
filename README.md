# 📘 xcraft-contrib-pacman

## Aperçu

Le module `xcraft-contrib-pacman` est un gestionnaire de paquets complet pour l'écosystème Xcraft. Il permet de créer, construire, installer, publier et gérer des paquets logiciels dans différentes distributions et architectures. Ce module s'appuie sur WPKG (Windows Package Manager) pour la gestion des paquets et fournit une interface complète pour manipuler le cycle de vie des paquets.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé en plusieurs composants principaux :

- **Commandes principales** (`pacman.js`) : Interface de commande pour toutes les opérations de gestion de paquets, exposées sur le bus Xcraft via `xcraftCommands`
- **Assistant de création** (`wizard.js`) : Interface interactive pour créer et modifier des définitions de paquets
- **Définition de paquets** (`lib/def.js`) : Gestion des définitions de paquets au format YAML
- **Construction** (`lib/build.js`) : Compilation des paquets source avec résolution des dépendances
- **Installation** (`lib/install.js`) : Installation des paquets dans un environnement cible
- **Publication** (`lib/publish.js`) : Publication des paquets dans des dépôts
- **Génération de fichiers** (`lib/file/`) : Création des fichiers de contrôle, changelog, copyright, CMakeLists et configuration d'environnement
- **Utilitaires** (`lib/utils.js`) : Fonctions utilitaires communes
- **Serveur HTTP** (`lib/wpkgHttp.js`) : Serveur Express pour accéder aux dépôts via HTTP
- **Administration** (`lib/admindir.js`) : Gestion des répertoires d'administration WPKG

## Fonctionnement global

Le flux de travail typique avec pacman est le suivant :

1. **Définition du paquet** : Création ou édition d'un fichier de configuration YAML décrivant le paquet (via `pacman.edit`)
2. **Make** : Génération des fichiers de contrôle et préparation du paquet (`pacman.make`)
3. **Build** : Compilation des sources pour les paquets source (`pacman.build`)
4. **Install** : Installation du paquet dans l'environnement cible (`pacman.install`)
5. **Publish** : Publication du paquet dans un dépôt pour le partager (`pacman.publish`)

Le module gère les dépendances entre paquets et permet de construire automatiquement les dépendances nécessaires lors de la construction d'un paquet. Il prend en charge trois types de dépendances :

- **Dépendances d'installation** (`install`) : Nécessaires pour exécuter le paquet
- **Dépendances de construction** (`build`) : Nécessaires pour compiler le paquet
- **Dépendances de make** (`make`) : Nécessaires pour générer les fichiers de contrôle, déployées avant la phase de make

### Pattern `@deps`

Dans les commandes acceptant des `packageRefs`, il est possible d'utiliser le motif `@deps` pour inclure automatiquement toutes les dépendances d'un paquet. Par exemple `my-package,@deps` résoudra récursivement toutes les dépendances de `my-package`.

### Gestion des versions et des hachages

Le système maintient automatiquement les références (`$ref`) et les hachages (`$hash`) des sources pour garantir la reproductibilité des builds. Lorsqu'un paquet est construit, ces informations sont mises à jour dans la définition du paquet.

### Système de tampons (stamps)

Pour optimiser les performances, pacman utilise un système de tampons (fichiers `.stamp`) qui permet d'éviter de reconstruire des paquets inchangés. Les tampons contiennent un hachage SHA des fichiers de définition et sont stockés dans les archives WPKG. Si les sources n'ont pas changé et que le paquet est déjà publié, la reconstruction est ignorée. Pour les dépôts Git, une vérification supplémentaire de la référence distante est effectuée.

### Gestion des distributions

Le module distingue deux types de distributions :

- **Toolchain** (défaut, `toolchain/`) : La distribution principale de développement
- **Distributions nommées** (ex. `yellow/`) : Des environnements produits séparés stockés dans des répertoires `prodroot.<distribution>`

Des configurations spécifiques à une distribution peuvent être définies dans des fichiers `config.<distribution>.yaml`, et des variantes encore plus spécifiques dans des fichiers `config.<distribution>+<variant>.yaml`.

### Serveur HTTP pour les dépôts

Si `http.enabled` est activé dans la configuration, un serveur Express est démarré au chargement du module (`_postload`) pour servir les dépôts WPKG via HTTP. Ce serveur surveille automatiquement les nouveaux répertoires de dépôts via `chokidar` et les enregistre dynamiquement comme routes.

## Exemples d'utilisation

### Créer ou éditer un paquet

```bash
# Lancer l'assistant interactif
zog pacman.edit my-package
```

L'assistant guide l'utilisateur à travers la configuration complète : nom, version, architecture, mainteneur, description, dépendances, sources, règles de construction, variables d'environnement.

### Construire un paquet

```bash
# Générer les fichiers de contrôle WPKG
zog pacman.make my-package

# Compiler le paquet source
zog pacman.build my-package

# Opération complète : make, build, install
zog pacman.full my-package
```

### Installer un paquet

```bash
# Installation simple
zog pacman.install my-package

# Installation avec une version spécifique depuis les archives
zog pacman.install my-package 1.0.0
```

### Publier et gérer les dépôts

```bash
# Publier dans un dépôt
zog pacman.publish /path/to/repo my-package

# Synchroniser les dépôts
zog pacman.syncRepository yellow/
```

### Inspecter les paquets

```bash
# Afficher les informations détaillées d'un paquet
zog pacman.show my-package

# Afficher le BOM (Bill of Materials) avec toutes les dépendances
zog pacman.bom my-package

# Vérifier les versions disponibles en ligne
zog pacman.version my-package

# Générer le graphe de dépendances
zog pacman.graph my-package yellow/

# Vérifier les versions installées vs définitions
zog pacman.listCheck
```

### Fusionner des définitions lors de conflits Git

```bash
# Résolution automatique des conflits de version dans les définitions
zog pacman.gitMergeDefinitions
```

## Interactions avec d'autres modules

- **[xcraft-core-etc]** : Chargement de la configuration du module et de Xcraft
- **[xcraft-core-fs]** : Opérations sur le système de fichiers (listage, copie, suppression)
- **[xcraft-core-platform]** : Détection de la plateforme hôte et de l'architecture
- **[xcraft-contrib-wpkg]** : Toutes les opérations WPKG sous-jacentes (construction, installation, publication)
- **[xcraft-contrib-peon]** : Téléchargement et préparation des sources lors du make
- **[xcraft-core-wizard]** : Interface d'édition interactive pour la création de paquets
- **[xcraft-core-env]** : Gestion et mise à jour des environnements de développement
- **[xcraft-core-placeholder]** : Injection de variables dans les templates de scripts
- **[xcraft-core-scm]** : Vérification des références distantes Git pour les tampons
- **[xcraft-core-uri]** : Résolution des URIs réelles à partir des définitions
- **[xcraft-core-ftp]** : Vérification des versions via FTP dans `pacman.version`
- **[goblin-overwatch]** : Surveillance et reporting des erreurs de construction

## Configuration avancée

| Option                   | Description                                                                    | Type    | Valeur par défaut                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architectures`          | Liste des architectures supportées                                             | Array   | mswindows-i386, mswindows-amd64, linux-i386, linux-amd64, linux-aarch64, darwin-i386, darwin-amd64, darwin-aarch64, solaris-i386, solaris-amd64, freebsd-i386, freebsd-amd64 |
| `pkgCfgFileName`         | Nom du fichier de configuration YAML pour les définitions                      | String  | `config.yaml`                                                                                                                                                                |
| `pkgScript`              | Nom du modèle pour les scripts WPKG (postinst, prerm)                          | String  | `script`                                                                                                                                                                     |
| `pkgMakeall`             | Nom du script make all pour les paquets source                                 | String  | `makeall`                                                                                                                                                                    |
| `pkgWPKG`                | Nom du répertoire WPKG dans les paquets                                        | String  | `WPKG`                                                                                                                                                                       |
| `pkgToolchainRepository` | Chemin du dépôt de la chaîne d'outils                                          | String  | `toolchain/`                                                                                                                                                                 |
| `pkgIndex`               | Fichier d'index pour les dépôts WPKG                                           | String  | `index.tar.gz`                                                                                                                                                               |
| `wpkgTemp`               | Répertoire temporaire pour WPKG                                                | String  | `./var/tmp/`                                                                                                                                                                 |
| `stamps`                 | Emplacement pour les tampons de construction (déprécié, migré automatiquement) | String  | `./var/xcraft-contrib-pacman/`                                                                                                                                               |
| `http.enabled`           | Active le serveur HTTP pour les dépôts WPKG                                    | Boolean | `true`                                                                                                                                                                       |
| `http.port`              | Port du serveur HTTP                                                           | Number  | `12321`                                                                                                                                                                      |
| `http.hostname`          | Adresse d'écoute du serveur HTTP                                               | String  | `0.0.0.0`                                                                                                                                                                    |

### Variables d'environnement

| Variable         | Description                                                                                                                 | Exemple                     | Valeur par défaut |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------- |
| `PEON_DEBUG_PKG` | Active le mode débogage pour `zeroBuild` sur le paquet spécifié ; empêche la construction automatique des dépendances build | `PEON_DEBUG_PKG=my-package` | —                 |

## Détails des sources

### `pacman.js`

Point d'entrée principal du module, il définit et expose toutes les commandes sur le bus Xcraft via `exports.xcraftCommands`. Chaque commande est un handler qui reçoit un message (`msg`) et un objet de réponse (`resp`).

Deux fonctions internes méritent une attention particulière :

**`extractPackages(packageRefs, distribution, resp, withMake, _pkgs)`** : Analyse une liste de références de paquets séparées par des virgules, résout récursivement les dépendances lorsque le motif `@deps` est utilisé, et retourne la liste plate des paquets à traiter ainsi que la distribution détectée.

**`wrapOverwatch(func, msg, resp)`** : Enveloppe une fonction génératrice avec le système overwatch : efface les erreurs précédentes avant l'exécution et collecte/rapporte les erreurs après.

#### Méthodes publiques (commandes)

- **`list(msg, resp)`** — Liste tous les paquets disponibles à partir des définitions locales, avec synchronisation préalable des liens symboliques
- **`listStatus(msg, resp, next)`** — Liste l'état des paquets installés via WPKG avec filtrage optionnel par pattern et architecture
- **`listCheck(msg, resp, next)`** — Compare les versions des paquets installés avec celles des définitions et signale les incohérences
- **`search(msg, resp, next)`** — Recherche des fichiers dans les paquets installés selon un pattern
- **`unlock(msg, resp, next)`** — Supprime le verrou de la base de données WPKG en cas de blocage
- **`edit(msg, resp)`** — Lance l'assistant wizard interactif pour créer ou modifier un paquet
- **`make(msg, resp, next)`** — Génère les fichiers de contrôle WPKG ; gère les dépendances make, le bumping automatique de version et le système de tampons
- **`install(msg, resp)`** — Installe un ou plusieurs paquets dans l'environnement cible
- **`reinstall(msg, resp)`** — Force la réinstallation d'un paquet déjà installé
- **`upgrade(msg, resp, next)`** — Met à jour tous les paquets d'une distribution via `wpkg update` puis `wpkg upgrade`
- **`status(msg, resp)`** — Vérifie l'état d'un paquet (installé et/ou publié) et émet un événement `pacman.status`
- **`show(msg, resp, next)`** — Affiche les informations détaillées d'un paquet via WPKG
- **`bom(msg, resp, next)`** — Génère récursivement la liste des matériaux (Bill of Materials) d'un paquet avec toutes ses dépendances et leurs versions
- **`build(msg, resp)`** — Compile un ou plusieurs paquets source avec résolution automatique des dépendances
- **`zeroBuild(msg, resp)`** — Prépare l'environnement de construction d'un paquet sans démarrer la compilation (utile pour déboguer manuellement)
- **`full(msg, resp)`** — Effectue make, build et install en séquence pour un ou plusieurs paquets
- **`remove(msg, resp)`** — Supprime un ou plusieurs paquets avec option de suppression récursive (`recursive=true`)
- **`removeAll(msg, resp, next)`** — Supprime tous les paquets d'une distribution en passant leur sélection en mode `auto` puis en exécutant `autoremove`
- **`autoremove(msg, resp)`** — Supprime automatiquement les paquets implicites non référencés
- **`clean(msg, resp)`** — Supprime les fichiers temporaires de construction
- **`publish(msg, resp)`** — Publie un ou plusieurs paquets dans un dépôt de destination
- **`unpublish(msg, resp)`** — Dépublie un ou plusieurs paquets et synchronise le dépôt
- **`addSource(msg, resp)`** — Ajoute une source de paquets (URI) à un répertoire cible
- **`delSource(msg, resp)`** — Supprime une source de paquets d'un répertoire cible
- **`syncRepository(msg, resp)`** — Synchronise les archives des dépôts
- **`graph(msg, resp)`** — Génère le graphe de dépendances pour un ou plusieurs paquets
- **`version(msg, resp)`** — Vérifie la disponibilité des versions (actuelles et suivantes) via HTTP/FTP
- **`refrhash(msg, resp, next)`** — Télécharge les sources de tous les paquets et met à jour les entrées `$hash` dans les définitions de base
- **`gitMergeDefinitions(msg, resp, next)`** — Résout automatiquement les conflits de merge Git dans les fichiers de définition en conservant la version la plus récente

### `wizard.js`

Définit l'assistant interactif pour la création et la modification de paquets. Il utilise `inquirer` pour présenter des questions en ligne de commande et exporte ses sections comme commandes via `xcraft-core-wizard`.

#### Sections de l'assistant

- **`header`** : Nom du paquet (validation Debian : minuscules, chiffres, `+`, `-`, `.`), version (format Debian), type outil/distribution, mainteneur, architecture, description, sous-paquets, liste de bump
- **`askdep/install`, `askdep/build`, `askdep/make`** : Demande si une dépendance doit être ajoutée pour chaque type
- **`dependency/install`, `dependency/build`, `dependency/make`** : Nom du paquet, version (avec opérateur de plage), architectures concernées, sous-paquets ou dépôt externe
- **`data`** : Type de fichier, type de règle, URI source, miroirs, référence SCM, commandes de configuration, test, installation, déploiement, variables PATH
- **`rulesEnv`** : Variables d'environnement pour la phase de construction (clé/valeur, répétable)
- **`env`** : Variables d'environnement générales du paquet (clé/valeur, répétable)
- **`chest`** : Option d'upload vers le serveur chest si l'URI est de type `chest:`

### `lib/admindir.js`

Gère les répertoires d'administration WPKG (équivalent de `/var/lib/dpkg`) et les sources de paquets. Crée le répertoire si nécessaire, enregistre les hooks et ajoute le dépôt local.

#### Méthodes publiques

- **`create(packageRef, targetRoot, distribution, next)`** — Crée ou initialise le répertoire d'administration WPKG pour un paquet donné, enregistre les hooks postinst/prerm et ajoute le dépôt local comme source
- **`addSource(uri, arch, distribution, location, components, next)`** — Ajoute une source de paquets (fichier sources.list) à un répertoire d'administration existant
- **`delSource(uri, arch, distribution, location, components, next)`** — Supprime une source de paquets du répertoire d'administration
- **`registerHooks(arch, distribution, next)`** — Enregistre les scripts hooks globaux (`postinst`, `prerm`) générés depuis le template

### `lib/build.js`

Orchestre la compilation complète des paquets source, depuis la résolution des dépendances jusqu'à la construction via WPKG. C'est le composant le plus complexe du module.

#### Flux de construction (`_build`)

1. Récupération des dépendances de construction (`_getBuildDeps`)
2. Construction récursive des dépendances source (`_buildDeps`)
3. Installation des dépendances de construction (`_installBuildDeps`)
4. Récupération des dépendances d'installation (`_getInstallDeps`)
5. Publication des sources dans un dépôt de staging temporaire (`_publishInstallDeps`), avec création de paquets stub pour les dépendances déjà archivées
6. Dépublication préventive des anciennes versions pour éviter les conflits de résolution
7. Construction depuis les sources via WPKG (`_buildSrc`)
8. Nettoyage des paquets stub

#### Méthodes publiques

- **`package(packageRef, distribution, next)`** — Point d'entrée principal : orchestre tout le processus de construction en initialisant les caches et en appelant `_tryBuild`

### `lib/clean.js`

Gère le nettoyage des fichiers temporaires de construction dans `pkgTempRoot`.

#### Méthodes publiques

- **`temp(packageName)`** — Supprime les fichiers temporaires pour un paquet spécifique ou, si `packageName` est nul, pour tous les paquets

### `lib/def.js`

Cœur de la gestion des définitions de paquets. Charge, valide, met à jour et sauvegarde les définitions YAML avec support des distributions multiples et des modifications non validées (unstage).

#### Structure d'une définition (`initDef`)

Une définition de paquet contient les champs suivants :

```
subpackage     : string[]           // Sous-paquets (ex. ['runtime*', 'dev'])
name           : string             // Nom Debian du paquet
version        : string             // Version (format Debian)
$version       : string             // Version sans epoch ni release Debian
distribution   : string             // Distribution cible (ex. 'toolchain/')
maintainer     : { name, email }
architecture   : string[]           // Ex. ['all'], ['source'], ['linux-amd64']
description    : { brief, long }
bump           : string[]           // Paquets à re-"make" si celui-ci change
dependency:
  install      : { [pkg]: [{version, architecture, subpackage?, external?}] }
  build        : { [pkg]: [{version, architecture, external?}] }
  make         : { [pkg]: [{version, architecture, external?}] }
data:
  get:
    uri        : string             // URI source (http, ftp, git, chest, ...)
    mirrors    : string[]           // URIs miroirs
    ref        : string             // Référence SCM (branche, tag, commit)
    $ref       : string             // Référence résolue (commit SHA)
    out        : string             // Nom de sortie du téléchargement
    externals  : boolean            // Cloner les sous-modules Git
    prepare    : string             // Commande de préparation des sources
  type         : string             // Type de données (src, installer, ...)
  configure    : string             // Commande de configuration
  rules:
    type       : string             // Règle d'installation (exec, meta, ...)
    location   : string             // Fichier/répertoire source
    args:
      postinst : string
      prerm    : string
      makeall  : string
      maketest : string
      makeinstall: string
    test       : string             // Méthode de test
    env        : { [key]: value }   // Variables d'environnement de build
  deploy       : string             // Commande de déploiement
  env:
    path       : string[]           // Chemins à ajouter au PATH
    other      : { [key]: value }   // Autres variables d'environnement
  embedded     : boolean            // Embarquer les données dans le paquet
  runtime:
    configure  : string             // Config pour le paquet binaire runtime
```

#### Méthodes publiques

- **`loadAll(packageName, props, resp)`** — Charge toutes les définitions d'un paquet pour toutes les distributions disponibles (fichiers `config*.yaml`)
- **`getBasePackageDef(packageName, resp)`** — Obtient la définition de base avec résolution des variantes `-src`, `-dev`, `-stub` et fusion des modifications unstaged
- **`load(packageName, props, resp, distribution)`** — Charge une définition complète pour une distribution spécifique en fusionnant base + distribution + props
- **`baseUpdate(packageName, props, resp)`** — Met à jour directement le fichier de base (sans passer par l'unstage)
- **`update(packageName, props, resp, distribution)`** — Met à jour les modifications non validées (fichier `.config.yaml`) ou le fichier de distribution spécifique
- **`save(packageDef, pkgConfig, resp)`** — Sauvegarde une définition avec calcul automatique de `$version` et nettoyage des champs vides
- **`removeUnstage(packageDef, resp)`** — Supprime le fichier de modifications non validées (`.config.yaml`)
- **`bumpPackageVersion(version)`** — Incrémente la version Debian : ajoute `-1` ou incrémente le suffixe `-N` existant

### `lib/edit.js`

Convertit les réponses de l'assistant wizard en une définition de paquet et sauvegarde le fichier YAML. Gère également le déclenchement de l'upload vers chest si l'URI est de type `chest:`.

#### Méthodes publiques

- **`pkgTemplate(inquirerPkg, resp, callbackInquirer, callback)`** — Transforme les réponses `inquirer` en définition de paquet, crée le répertoire si nécessaire, sauvegarde la définition et supprime le fichier unstage

### `lib/fullpac.js`

Fonction génératrice utilitaire qui enchaîne `pacman.make` (avec `@deps`), `pacman.build` et `pacman.install` pour un seul paquet. Utilisée par `pacman.full` et par `lib/make.js` pour déployer les dépendances make.

### `lib/graph.js`

Génère des graphiques de dépendances en déléguant à WPKG.

#### Méthodes publiques

- **`graph(packageNames, distribution, next)`** — Génère un graphique de dépendances pour les paquets spécifiés via `xcraft-contrib-wpkg`

### `lib/index.js`

Fournit des fonctions utilitaires pour la gestion des chemins de dépôts et l'initialisation du serveur HTTP.

#### Méthodes publiques

- **`getTargetRoot(distribution, resp)`** — Retourne le répertoire racine cible pour une distribution (le `prodroot.<distribution>` pour les distributions nommées, ou `pkgTargetRoot` pour la toolchain)
- **`getDebRoot(distribution, resp)`** — Retourne le répertoire racine des paquets WPKG pour une distribution (`wpkg.<distribution>` ou `pkgDebRoot`)
- **`wpkgHttp()`** — Initialise et retourne l'instance `WpkgHttp` si `http.enabled` est vrai, sinon `null`
- **`dispose()`** — Arrête proprement le serveur HTTP si actif

### `lib/install.js`

Gère l'installation des paquets dans un environnement cible en créant d'abord le répertoire d'administration si nécessaire.

#### Méthodes publiques

- **`package(packageRef, distribution, prodRoot, reinstall, next)`** — Installation standard via le dépôt configuré
- **`packageArchive(packageRef, version, distribution, prodRoot, reinstall, next)`** — Installation depuis une archive versionnée spécifique
- **`externalPackage(packageRef, distribution, prodRoot, reinstall, next)`** — Installation d'un paquet externe par nom (sans dépôt local)
- **`status(packageRef, distribution, next)`** — Vérifie si un paquet est installé et retourne `{ version, installed }`

### `lib/list.js`

Fournit des fonctions pour lister les paquets disponibles depuis les définitions locales.

#### Méthodes publiques

- **`listProducts(resp)`** — Parcourt `pkgProductsRoot` et retourne la liste des paquets avec `{ Name, Version, Distribution, Architecture }`

### `lib/make.js`

Responsable de la génération des fichiers de contrôle WPKG et de la préparation des paquets. C'est le composant central du cycle de make.

#### Processus de make (`package`)

1. Déploiement des dépendances make (`_deployMakeDep` → `fullpac` si nécessaire)
2. Vérification du tampon (stamp) pour détecter les changements
3. Vérification et bumping automatique de version si le paquet est déjà archivé
4. Génération des fichiers : control, changelog, copyright, CMakeLists, etc.
5. Copie des patches et assets, téléchargement/préparation des sources via peon
6. Construction du paquet WPKG (`wpkgBuild`)
7. Injection de `$ref` et `$hash` dans la définition si mis à jour
8. Mise à jour du fichier de tampon

#### Méthodes publiques

- **`package(packageName, arch, defProps, outputRepository, distribution)`** — Génère la structure complète du paquet avec toutes les optimisations ; retourne `{ bump: string[], make: boolean }`
- **`injectHash(packageName, hash, distribution)`** — Met à jour le `$hash` dans le fichier unstage de la définition
- **`injectBaseHash(packageName, hash)`** — Met à jour le `$hash` directement dans le fichier de base (utilisé par `refrhash`)

### `lib/publish.js`

Responsable de la publication et de la gestion des paquets dans les dépôts WPKG. Redirige automatiquement les paquets `-src` vers le dépôt `sources/`.

#### Méthodes publiques

- **`add(packageRef, inputRepository, outputRepository, distribution, next)`** — Publie un paquet dans le dépôt de destination
- **`remove(packageRef, repository, distribution, updateIndex, next)`** — Dépublie un paquet du dépôt
- **`removeAll(packageList, repository, distribution, next)`** — Dépublie une liste de paquets en séquence
- **`status(packageRef, distribution, repositoryPath, next)`** — Vérifie si un paquet est publié et retourne ses informations ou `false`
- **`getNewVersionIfArchived(packageRef, version, distribution, targetDistribution)`** — Détermine si la version désirée est déjà archivée et, si oui, calcule une version bumpée ; boucle jusqu'à trouver une version libre

### `lib/remove.js`

Gère la suppression des paquets installés via WPKG.

#### Méthodes publiques

- **`package(packageRef, distribution, recursive, next)`** — Supprime un paquet avec option de suppression récursive des dépendances orphelines

### `lib/utils.js`

Fournit des fonctions utilitaires communes à l'ensemble du module.

#### Méthodes publiques

- **`checkArch(arch)`** — Vérifie si une architecture est dans la liste des architectures supportées (configuration pacman)
- **`parsePkgRef(packageRef)`** — Analyse une référence de paquet au format `name:arch` ; si pas d'architecture, utilise l'architecture courante ; `all` retourne `null` comme architecture
- **`checkOsSupport(packageName, packageArch, packageDef, arch)`** — Vérifie la compatibilité OS : les paquets `mswindows-*` ne peuvent être construits que sous Windows
- **`injectThisPh(packageDef, data)`** — Injecte les placeholders `THIS.*` dans une chaîne en utilisant les valeurs de la définition
- **`flatten(object)`** — Aplatit un objet imbriqué en un objet à une seule profondeur avec clés pointées (`data.get.uri`)
- **`getDistributions(packageDef)`** — Retourne la liste des distributions non-spécifiques disponibles pour un paquet
- **`errorReporting(resp)`** — Génère un rapport d'erreurs formaté avec bannière visuelle depuis overwatch
- **`makeGetObj(packageDef)`** — Crée l'objet de récupération avec URIs et références résolues via les placeholders

### `lib/wpkgHttp.js`

Implémente un serveur HTTP Express pour accéder aux dépôts WPKG via le réseau.

#### Fonctionnalités

- Surveillance automatique de `var/wpkg*` via `chokidar` pour détecter de nouveaux dépôts
- Enregistrement dynamique de routes Express pour chaque dépôt détecté
- Gestion du fallback de distribution pour les variantes `distribution+variant` : si le répertoire spécifique n'existe pas, redirige vers la distribution de base
- Service des archives versionnées sous la route `/versions`

#### Méthodes publiques

- **`serve()`** — Démarre le serveur HTTP sur le port et l'hôte configurés
- **`dispose(next)`** — Arrête proprement le serveur HTTP et le watcher de fichiers

### Fichiers de génération (`lib/file/`)

Ces modules génèrent les fichiers nécessaires dans le répertoire temporaire de construction (`pkgTempRoot/<arch>/<package>/WPKG/`) avant l'appel à WPKG.

#### `lib/file/control.js`

Génère les fichiers de contrôle WPKG (`control` ou `control.info` pour les paquets avec sous-paquets) à partir de la définition. Gère la syntaxe multi-architectures, les sous-paquets avec leurs dépendances spécifiques, les dépendances externes (`*distrib@name`), et les fichiers owners pour les sous-paquets `x+*`.

#### `lib/file/changelog.js`

Génère les fichiers `ChangeLog` avec horodatage automatique au format RFC 2822 et injection des distributions ciblées.

#### `lib/file/copyright.js`

Génère les fichiers `copyright` à partir du template en injectant le nom du paquet et les informations du mainteneur.

#### `lib/file/cmakelists.js`

Génère le fichier `CMakeLists.txt` pour les paquets source (`architecture: source`), nécessaire pour la construction via WPKG.

#### `lib/file/etc.js`

Génère les fichiers de configuration d'environnement au format JSON dans `etc/env/<key>/<packageName>.json`, utilisés par le système de gestion d'environnement Xcraft lors de l'installation.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-platform]: https://github.com/Xcraft-Inc/xcraft-core-platform
[xcraft-contrib-wpkg]: https://github.com/Xcraft-Inc/xcraft-contrib-wpkg
[xcraft-contrib-peon]: https://github.com/Xcraft-Inc/xcraft-contrib-peon
[xcraft-core-wizard]: https://github.com/Xcraft-Inc/xcraft-core-wizard
[xcraft-core-env]: https://github.com/Xcraft-Inc/xcraft-core-env
[xcraft-core-placeholder]: https://github.com/Xcraft-Inc/xcraft-core-placeholder
[xcraft-core-scm]: https://github.com/Xcraft-Inc/xcraft-core-scm
[xcraft-core-uri]: https://github.com/Xcraft-Inc/xcraft-core-uri
[xcraft-core-ftp]: https://github.com/Xcraft-Inc/xcraft-core-ftp
[goblin-overwatch]: https://github.com/Xcraft-Inc/goblin-overwatch

_Ce contenu a été généré par IA_
