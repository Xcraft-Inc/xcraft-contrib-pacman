# 📘 Documentation du module xcraft-contrib-pacman

## Aperçu

Le module `xcraft-contrib-pacman` est un gestionnaire de paquets complet pour l'écosystème Xcraft. Il permet de créer, construire, installer, publier et gérer des paquets logiciels dans différentes distributions et architectures. Ce module s'appuie sur WPKG (Windows Package Manager) pour la gestion des paquets et fournit une interface complète pour manipuler le cycle de vie des paquets.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Variables d'environnement](#variables-denvironnement)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé en plusieurs composants principaux :

- **Commandes principales** (`pacman.js`) : Interface de commande pour toutes les opérations de gestion de paquets
- **Définition de paquets** (`lib/def.js`) : Gestion des définitions de paquets au format YAML
- **Construction** (`lib/build.js`) : Compilation des paquets source
- **Installation** (`lib/install.js`) : Installation des paquets dans un environnement cible
- **Publication** (`lib/publish.js`) : Publication des paquets dans des dépôts
- **Génération de fichiers** (`lib/file/`) : Création des fichiers de contrôle, changelog, copyright, etc.
- **Utilitaires** (`lib/utils.js`) : Fonctions utilitaires communes
- **Serveur HTTP** (`lib/wpkgHttp.js`) : Serveur pour accéder aux dépôts via HTTP
- **Administration** (`lib/admindir.js`) : Gestion des répertoires d'administration WPKG

## Fonctionnement global

Le flux de travail typique avec pacman est le suivant :

1. **Définition du paquet** : Création ou édition d'un fichier de configuration YAML décrivant le paquet
2. **Make** : Génération des fichiers de contrôle et préparation du paquet
3. **Build** : Compilation des sources (pour les paquets source)
4. **Install** : Installation du paquet dans l'environnement cible
5. **Publish** : Publication du paquet dans un dépôt pour le partager

Le module gère également les dépendances entre paquets, permettant de construire automatiquement les dépendances nécessaires lors de la construction d'un paquet. Il prend en charge différents types de dépendances :

- **Dépendances d'installation** : Nécessaires pour exécuter le paquet
- **Dépendances de construction** : Nécessaires pour compiler le paquet
- **Dépendances de make** : Nécessaires pour générer les fichiers de contrôle

### Gestion des versions et des hachages

Le système maintient automatiquement les références (`$ref`) et les hachages (`$hash`) des sources pour garantir la reproductibilité des builds. Lorsqu'un paquet est construit, ces informations sont mises à jour dans la définition du paquet.

### Système de tampons (stamps)

Pour optimiser les performances, pacman utilise un système de tampons qui permet d'éviter de reconstruire des paquets inchangés. Les tampons sont stockés dans le répertoire spécifié par la configuration `stamps`.

## Exemples d'utilisation

### Créer un nouveau paquet

```bash
zog pacman.edit my-package
```

Cette commande lance un assistant interactif pour créer ou modifier la définition d'un paquet.

### Construire un paquet

```bash
# Générer les fichiers de contrôle
zog pacman.make my-package

# Compiler le paquet source
zog pacman.build my-package
```

### Installer un paquet

```bash
# Installation simple
zog pacman.install my-package

# Installation avec une version spécifique
zog pacman.install my-package '' '' 1.0.0
```

### Publier un paquet

```bash
zog pacman.publish /path/to/repo my-package myDistribution
```

### Opération complète (make, build, install)

```bash
zog pacman.full my-package
```

### Vérifier les dépendances d'un paquet

```bash
zog pacman.bom my-package
```

### Vérifier les versions disponibles d'un paquet

```bash
zog pacman.version my-package
```

### Générer un graphe de dépendances

```bash
zog pacman.graph my-package
```

## Interactions avec d'autres modules

- **[xcraft-core-etc]** : Pour la configuration
- **[xcraft-core-fs]** : Pour les opérations sur le système de fichiers
- **[xcraft-core-platform]** : Pour la détection de la plateforme
- **[xcraft-contrib-wpkg]** : Pour les opérations WPKG sous-jacentes
- **[xcraft-contrib-peon]** : Pour les opérations de construction
- **[xcraft-core-wizard]** : Pour l'interface d'édition interactive
- **[xcraft-core-env]** : Pour la gestion des environnements
- **[xcraft-core-placeholder]** : Pour l'injection de variables dans les templates
- **[goblin-overwatch]** : Pour la gestion des erreurs et le reporting

## Configuration avancée

Le module peut être configuré via le fichier `config.js` :

| Option                 | Description                                               | Type    | Valeur par défaut                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| architectures          | Liste des architectures supportées                        | Array   | mswindows-i386, mswindows-amd64, linux-i386, linux-amd64, linux-aarch64, darwin-i386, darwin-amd64, darwin-aarch64, solaris-i386, solaris-amd64, freebsd-i386, freebsd-amd64 |
| pkgCfgFileName         | Nom du fichier de configuration pour les définitions WPKG | String  | config.yaml                                                                                                                                                                  |
| pkgScript              | Nom du modèle pour les scripts WPKG                       | String  | script                                                                                                                                                                       |
| pkgMakeall             | Nom du script make all                                    | String  | makeall                                                                                                                                                                      |
| pkgWPKG                | Répertoire pour les paquets WPKG                          | String  | WPKG                                                                                                                                                                         |
| pkgToolchainRepository | Chemin du dépôt de la chaîne d'outils                     | String  | toolchain/                                                                                                                                                                   |
| pkgIndex               | Fichier d'index pour les dépôts WPKG                      | String  | index.tar.gz                                                                                                                                                                 |
| wpkgTemp               | Répertoire temporaire pour WPKG                           | String  | ./var/tmp/                                                                                                                                                                   |
| stamps                 | Emplacement pour les tampons de construction              | String  | ./var/xcraft-contrib-pacman/                                                                                                                                                 |
| http.enabled           | Activer le serveur HTTP pour les dépôts WPKG              | Boolean | true                                                                                                                                                                         |
| http.port              | Port du serveur HTTP                                      | Number  | 12321                                                                                                                                                                        |
| http.hostname          | Nom d'hôte du serveur HTTP                                | String  | 0.0.0.0                                                                                                                                                                      |

### Variables d'environnement

| Variable       | Description                                       | Exemple                   | Valeur par défaut |
| -------------- | ------------------------------------------------- | ------------------------- | ----------------- |
| PEON_DEBUG_PKG | Définit le paquet en mode débogage pour zeroBuild | PEON_DEBUG_PKG=my-package | -                 |

## Détails des sources

### `pacman.js`

Ce fichier est le point d'entrée principal du module. Il définit toutes les commandes disponibles pour manipuler les paquets. Le fichier exporte `xcraftCommands` qui expose les commandes sur le bus Xcraft.

#### Fonctions principales

- **Extraction de paquets** : La fonction `extractPackages` analyse les références de paquets et résout les dépendances avec le motif `@deps`
- **Gestion des erreurs** : La fonction `wrapOverwatch` intègre le système de surveillance des erreurs
- **Commandes de cycle de vie** : Toutes les opérations de gestion de paquets sont exposées comme commandes

#### Méthodes publiques

- **`list(msg, resp)`** — Liste tous les paquets disponibles à partir des définitions
- **`listStatus(msg, resp, next)`** — Liste l'état des paquets installés avec filtrage par pattern et architecture
- **`listCheck(msg, resp, next)`** — Vérifie les versions des paquets installés par rapport aux définitions
- **`search(msg, resp, next)`** — Recherche des fichiers dans les paquets installés
- **`unlock(msg, resp, next)`** — Supprime le verrou de la base de données WPKG
- **`edit(msg, resp)`** — Lance l'assistant interactif pour créer ou modifier un paquet
- **`make(msg, resp, next)`** — Génère les fichiers de contrôle pour WPKG avec gestion des dépendances make
- **`install(msg, resp)`** — Installe un paquet dans l'environnement cible
- **`reinstall(msg, resp)`** — Réinstalle un paquet existant
- **`upgrade(msg, resp, next)`** — Met à jour tous les paquets d'une distribution
- **`status(msg, resp)`** — Vérifie l'état d'un paquet (installé et/ou publié)
- **`show(msg, resp, next)`** — Affiche les informations détaillées d'un paquet
- **`bom(msg, resp, next)`** — Affiche la liste des matériaux (Bill of Materials) d'un paquet avec toutes ses dépendances
- **`build(msg, resp)`** — Compile un paquet source avec résolution automatique des dépendances
- **`zeroBuild(msg, resp)`** — Prépare un paquet pour la construction sans démarrer la compilation (mode débogage)
- **`full(msg, resp)`** — Effectue make, build et install en une seule opération
- **`remove(msg, resp)`** — Supprime un paquet avec option récursive
- **`removeAll(msg, resp, next)`** — Supprime tous les paquets d'une distribution
- **`autoremove(msg, resp)`** — Supprime automatiquement les paquets implicites
- **`clean(msg, resp)`** — Supprime les fichiers temporaires de construction
- **`publish(msg, resp)`** — Publie un paquet dans un dépôt
- **`unpublish(msg, resp)`** — Dépublie un paquet d'un dépôt
- **`addSource(msg, resp)`** — Ajoute une nouvelle source à un répertoire cible
- **`delSource(msg, resp)`** — Supprime une source d'un répertoire cible
- **`syncRepository(msg, resp)`** — Synchronise les dépôts d'archives
- **`graph(msg, resp)`** — Génère le graphe de dépendances pour un ou plusieurs paquets
- **`version(msg, resp)`** — Vérifie et teste les versions disponibles d'un paquet
- **`refrhash(msg, resp, next)`** — Actualise les entrées \$hash des définitions en téléchargeant les sources
- **`gitMergeDefinitions(msg, resp, next)`** — Fusionne automatiquement les définitions de paquets lors de conflits Git

### `wizard.js`

Ce fichier définit l'assistant interactif pour la création et la modification de paquets. Il utilise le module `inquirer` pour créer une interface en ligne de commande interactive.

#### Sections de l'assistant

- **header** : Informations générales du paquet (nom, version, architecture, mainteneur, description)
- **askdep** : Questions pour ajouter des dépendances (install, build, make)
- **dependency** : Configuration détaillée des dépendances
- **data** : Configuration des données source (URI, type, règles de construction)
- **rulesEnv** : Variables d'environnement pour la construction
- **env** : Variables d'environnement générales
- **chest** : Options de téléchargement vers le serveur chest

### `lib/admindir.js`

Gère les répertoires d'administration WPKG et les sources de paquets.

#### Méthodes publiques

- **`addSource(uri, arch, distribution, location, components, next)`** — Ajoute une source de paquets à un répertoire d'administration
- **`delSource(uri, arch, distribution, location, components, next)`** — Supprime une source de paquets d'un répertoire d'administration
- **`registerHooks(arch, distribution, next)`** — Enregistre les hooks post-installation et pré-suppression
- **`create(packageRef, targetRoot, distribution, next)`** — Crée un répertoire d'administration WPKG avec configuration automatique

### `lib/build.js`

Responsable de la compilation des paquets source avec gestion complète des dépendances.

#### Fonctionnalités principales

- Résolution récursive des dépendances de construction
- Installation automatique des dépendances manquantes
- Gestion des paquets stub pour éviter les conflits de versions
- Support des dépendances externes

#### Méthodes publiques

- **`package(packageRef, distribution, next)`** — Orchestre tout le processus de construction d'un paquet avec gestion des dépendances

### `lib/clean.js`

Gère le nettoyage des fichiers temporaires de construction.

#### Méthodes publiques

- **`temp(packageName)`** — Supprime les fichiers temporaires pour un paquet spécifique ou tous les paquets

### `lib/def.js`

Gère les définitions de paquets au format YAML avec support des distributions multiples.

#### Fonctionnalités principales

- Chargement et sauvegarde des définitions YAML
- Support des configurations par distribution
- Gestion des modifications non validées (unstage)
- Validation et nettoyage automatique des définitions

#### Méthodes publiques

- **`loadAll(packageName, props, resp)`** — Charge toutes les définitions d'un paquet pour toutes les distributions
- **`getBasePackageDef(packageName, resp)`** — Obtient la définition de base d'un paquet avec résolution des sous-paquets
- **`load(packageName, props, resp, distribution)`** — Charge une définition de paquet pour une distribution spécifique
- **`update(packageName, props, resp, distribution)`** — Met à jour une définition de paquet
- **`save(packageDef, pkgConfig, resp)`** — Sauvegarde une définition de paquet avec nettoyage automatique
- **`removeUnstage(packageDef, resp)`** — Supprime les modifications non validées
- **`bumpPackageVersion(version)`** — Incrémente automatiquement la version d'un paquet

### `lib/edit.js`

Convertit les réponses de l'assistant interactif en définitions de paquets.

#### Méthodes publiques

- **`pkgTemplate(inquirerPkg, resp, callbackInquirer, callback)`** — Crée un modèle de paquet à partir des réponses de l'assistant

### `lib/fullpac.js`

Fonction utilitaire qui effectue une séquence complète make, build, install.

### `lib/graph.js`

Génère des graphiques de dépendances pour visualiser les relations entre paquets.

#### Méthodes publiques

- **`graph(packageNames, distribution, next)`** — Génère un graphique de dépendances pour les paquets spécifiés

### `lib/index.js`

Fournit des fonctions utilitaires pour la gestion des chemins et la configuration du serveur HTTP.

#### Méthodes publiques

- **`getTargetRoot(distribution, resp)`** — Retourne le répertoire racine cible pour une distribution
- **`getDebRoot(distribution, resp)`** — Retourne le répertoire racine des paquets Debian pour une distribution
- **`wpkgHttp()`** — Initialise et retourne l'instance du serveur HTTP WPKG
- **`dispose()`** — Nettoie les ressources du module

### `lib/install.js`

Gère l'installation des paquets dans un environnement cible.

#### Méthodes publiques

- **`package(packageRef, distribution, prodRoot, reinstall, next)`** — Installation standard d'un paquet
- **`packageArchive(packageRef, version, distribution, prodRoot, reinstall, next)`** — Installation à partir d'une archive spécifique
- **`externalPackage(packageRef, distribution, prodRoot, reinstall, next)`** — Installation d'un paquet externe
- **`status(packageRef, distribution, next)`** — Vérification de l'état d'installation d'un paquet

### `lib/list.js`

Fournit des fonctions pour lister les paquets disponibles.

#### Méthodes publiques

- **`listProducts(resp)`** — Retourne la liste de tous les paquets disponibles avec leurs métadonnées

### `lib/make.js`

Responsable de la génération des fichiers de contrôle et de la préparation des paquets pour WPKG.

#### Fonctionnalités principales

- Génération des fichiers de contrôle WPKG
- Gestion des tampons pour éviter les reconstructions inutiles
- Support des dépendances make
- Injection automatique des références et hachages

#### Méthodes publiques

- **`package(packageName, arch, defProps, outputRepository, distribution)`** — Génère la structure complète du paquet avec optimisations
- **`injectHash(packageName, hash, distribution = null)`** — Met à jour le hachage d'un paquet dans sa définition

### `lib/publish.js`

Responsable de la publication des paquets dans des dépôts.

#### Méthodes publiques

- **`add(packageRef, inputRepository, outputRepository, distribution, next)`** — Ajoute un paquet à un dépôt
- **`remove(packageRef, repository, distribution, updateIndex, next)`** — Supprime un paquet d'un dépôt
- **`removeAll(packageList, repository, distribution, next)`** — Supprime plusieurs paquets d'un dépôt
- **`status(packageRef, distribution, repositoryPath, next)`** — Vérifie l'état de publication d'un paquet
- **`getNewVersionIfArchived(packageRef, version, distribution, targetDistribution)`** — Détermine si une nouvelle version est nécessaire

### `lib/remove.js`

Gère la suppression des paquets installés.

#### Méthodes publiques

- **`package(packageRef, distribution, recursive, next)`** — Supprime un paquet avec option de suppression récursive des dépendances

### `lib/utils.js`

Fournit des fonctions utilitaires communes pour le module.

#### Méthodes publiques

- **`checkArch(arch)`** — Vérifie si une architecture est supportée
- **`parsePkgRef(packageRef)`** — Analyse une référence de paquet (nom:architecture)
- **`checkOsSupport(packageName, packageArch, packageDef, arch)`** — Vérifie la compatibilité avec le système d'exploitation
- **`injectThisPh(packageDef, data)`** — Injecte les placeholders dans les données
- **`flatten(object)`** — Aplatit un objet en propriétés à points
- **`getDistributions(packageDef)`** — Obtient la liste des distributions disponibles pour un paquet
- **`errorReporting(resp)`** — Génère un rapport d'erreurs formaté
- **`makeGetObj(packageDef)`** — Crée un objet de récupération avec URIs résolues

### `lib/wpkgHttp.js`

Implémente un serveur HTTP pour accéder aux dépôts WPKG via le web.

#### Fonctionnalités principales

- Serveur Express pour servir les dépôts WPKG
- Surveillance automatique des nouveaux dépôts
- Gestion des fallbacks de distribution
- Support des dépôts versionnés

#### Méthodes publiques

- **`serve()`** — Démarre le serveur HTTP sur le port configuré
- **`dispose(next)`** — Arrête proprement le serveur et libère les ressources

### Fichiers de génération (`lib/file/`)

Ces modules génèrent les différents fichiers nécessaires pour un paquet WPKG :

#### `lib/file/control.js`

Génère les fichiers de contrôle WPKG avec toutes les métadonnées du paquet.

#### `lib/file/changelog.js`

Génère les fichiers de changelog avec horodatage automatique.

#### `lib/file/copyright.js`

Génère les fichiers de copyright à partir des informations du mainteneur.

#### `lib/file/cmakelists.js`

Génère les fichiers CMakeLists.txt pour les paquets source.

#### `lib/file/etc.js`

Génère les fichiers de configuration d'environnement au format JSON.

_Cette documentation a été mise à jour._

[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-platform]: https://github.com/Xcraft-Inc/xcraft-core-platform
[xcraft-contrib-wpkg]: https://github.com/Xcraft-Inc/xcraft-contrib-wpkg
[xcraft-contrib-peon]: https://github.com/Xcraft-Inc/xcraft-contrib-peon
[xcraft-core-wizard]: https://github.com/Xcraft-Inc/xcraft-core-wizard
[xcraft-core-env]: https://github.com/Xcraft-Inc/xcraft-core-env
[xcraft-core-placeholder]: https://github.com/Xcraft-Inc/xcraft-core-placeholder
[goblin-overwatch]: https://github.com/Xcraft-Inc/goblin-overwatch