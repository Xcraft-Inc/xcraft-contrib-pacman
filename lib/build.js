'use strict';

const path = require('path');
const watt = require('gigawatts');
const _ = require('lodash');

const utils = require('./utils.js');
const definition = require('./def.js');
const {getTargetRoot} = require('./index.js');

const xEnv = require('xcraft-core-env');
const xFs = require('xcraft-core-fs');

class Build {
  constructor(resp) {
    this._resp = resp;

    const pacmanConfig = require('xcraft-core-etc')(null, this._resp).load(
      'xcraft-contrib-pacman'
    );
    this._devDistribution = pacmanConfig.pkgToolchainRepository;

    this._admindir = require('./admindir.js')(resp);
    this._install = require('./install.js')(resp);
    this._remove = require('./remove.js')(resp);
    this._publish = require('./publish.js')(resp);
    this._make = require('./make.js')(resp);
    this._clean = require('./clean.js')(resp);
    this._wpkg = require('xcraft-contrib-wpkg')(resp);

    watt.wrapAll(this);
  }

  /**
   * Call the build function for each build dependencies.
   *
   * The src dependencies that are already built, are skipped. But note that
   * the versions are not checked.
   *
   * @param {string} packageList
   * @param {string} arch - Architecture.
   */
  *_buildDeps(packageList, arch) {
    const list = [];

    /* Extract all dependencies (not recursively). */
    packageList.forEach(dep => {
      const depDef = definition.load(
        dep,
        null,
        this._resp,
        this._devDistribution
      );

      list.push({
        type: depDef.architecture.indexOf('source') === -1 ? 'bin' : 'src',
        name: dep,
      });
    });

    /* Build the packages that are not already built. */
    // FIXME: check the package version
    for (const pkg of list) {
      if (pkg.type === 'bin') {
        yield this._tryBuild(pkg.name, arch, this._devDistribution, false);
        continue;
      }

      /* Only for 'src' type. */
      const deb = yield this._publish.status(pkg.name, null, null);
      if (!deb) {
        yield this._tryBuild(pkg.name, arch, this._devDistribution, false);
      }
    }
  }

  static _buildList(buildDeps, arch) {
    return Object.keys(buildDeps).filter(name =>
      buildDeps[name].some(
        dep => !dep.architecture.length || dep.architecture.includes(arch)
      )
    );
  }

  /**
   * Get all build dependencies.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @returns {string[]} the list of build packages.
   */
  _getBuildDeps(packageName, arch) {
    const packageDef = definition.load(
      packageName,
      null,
      this._resp,
      this._devDistribution
    );

    let list = Build._buildList(packageDef.dependency.build, arch);

    for (const dep of Build._installList(packageDef.dependency.install, arch)) {
      const depDef = definition.load(
        dep,
        null,
        this._resp,
        this._devDistribution
      );
      list = list.concat(Build._buildList(depDef.dependency.build, arch));
    }

    return _.uniq(list);
  }

  /**
   * Install all build dependencies.
   *
   * @param {string[]} packagelist - The list of packages to install.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name.
   * @param {function(err)} next
   */
  *_installBuildDeps(packagelist, arch, distribution, next) {
    try {
      for (const pkg of packagelist) {
        /* FIXME: check the package version
         * Note that by default the install process skip the same version
         * then this check seems useless. But many validations are done on
         * the package and the target tree and it takes a significant
         * amount of time.
         */
        const {installed} = yield this._install.status(pkg, null);
        if (!installed) {
          yield this._install.package(pkg, null, null, false, next);
        }
      }
    } catch (ex) {
      throw ex;
    } finally {
      xEnv.devrootUpdate(distribution);
    }
  }

  static _installList(installDeps, arch) {
    return Object.keys(installDeps).filter(name =>
      installDeps[name].some(
        dep => !dep.architecture.length || dep.architecture.includes(arch)
      )
    );
  }

  /**
   * Get all install dependencies recursively.
   *
   * It returns a list of all 'src' dependencies recursively in all packages.
   * It's not like getBuildDeps because it's possible to have packages that are
   * not directly referenced in the initial package definition.
   *
   * The goal is to use this list with wpkg. Then it's the wpkg responsability
   * to resolve the dependencies.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name.
   * @returns {Object[]} the install list.
   */
  *_getInstallDeps(packageName, arch, distribution) {
    const packageDef = definition.load(
      packageName,
      null,
      this._resp,
      distribution
    );
    let list = {};

    /* Here we retrieve all install dependencies even if the architecture
     * doesn't match. It's necessary in the case of src packages build
     * to provide everything. It's a problem because some dependencies
     * are installed when it should be used only with some platforms.
     */
    for (const dep of Object.keys(packageDef.dependency.install)) {
      const depDef = definition.load(dep, null, this._resp, distribution);

      if (depDef.architecture.indexOf('source') === -1) {
        throw new Error('only source package are supported');
      }

      // FIXME: handle the package version
      list[dep] = true;
      const newList = yield this._getInstallDeps(dep, arch, distribution);
      _.merge(list, newList);
    }

    return list;
  }

  /**
   * Publish the list of packages in a specified repository.
   *
   * The main purpose is to publish these packages in a temporary repository
   * that will be used by wpkg (make world like).
   *
   * @param {string} packageName - Main package.
   * @param {string[]} packageList
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} outputRepository - Location.
   * @param {function} next
   * @returns {string[]} the list of stubs.
   */
  *_publishInstallDeps(
    packageName,
    packageList,
    arch,
    distribution,
    outputRepository,
    next
  ) {
    let isEmpty = true;
    const list = [];

    if (packageName) {
      yield this._publish.add(
        packageName,
        null,
        outputRepository,
        distribution
      );
      isEmpty = false;
    }

    for (const pkg of packageList) {
      const packageName = pkg.replace(/-src$/, '');

      /* Check if this package is not already built. */
      // FIXME: handle the package version
      const deb = yield this._publish.status(packageName, distribution, null);
      if (!deb) {
        yield this._publish.add(pkg, null, outputRepository, distribution);
        isEmpty = false;
        continue;
      }

      list.push(packageName);
    }

    /* Nothing published, it's useless to build only stubs. */
    if (isEmpty) {
      return {
        skip: true,
        list: [],
      };
    }

    for (const packageName of list) {
      const props = definition.load(
        packageName,
        null,
        this._resp,
        distribution
      );
      props._stub = true;
      delete props.data;

      this._clean.temp(packageName);
      yield this._make.package(
        'toolchain+stub',
        arch,
        utils.flatten(props),
        outputRepository,
        next
      );
    }

    return {
      skip: false,
      list: list,
    };
  }

  /**
   * Build all packages available in the specified repository.
   *
   * The output binary repository is the usual (default) repository.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} repository - Location.
   * @param {function(err)} next
   */
  *_buildSrc(packageName, arch, distribution, repository, next) {
    const name = packageName ? packageName + '-src' : null;
    yield this._wpkg.buildFromSrc(name, arch, repository, distribution, next);
  }

  /**
   * Unpublish the stub package.
   *
   * @param {string[]} list
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} repository
   */
  *_unpublishStub(list, distribution, repository) {
    list = list.map(stub => `${stub}-stub`);
    yield this._publish.removeAll(list, repository, distribution);
  }

  /**
   * Main build function.
   *
   * This function tries to handle all build cases.
   * For example:
   * - Packages with src build dependencies.
   * - Packages with src install dependencies.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {boolean} topPackage
   */
  *_build(packageName, arch, distribution, topPackage) {
    const xcraftConfig = require('xcraft-core-etc')(null, this._resp).load(
      'xcraft'
    );

    const outputRepository = path.join(
      xcraftConfig.tempRoot,
      'wpkg-src-staging'
    );

    try {
      /* Step 1 */
      this._resp.log.info(`get build dependencies of ${packageName}`);
      const buildDepsList = this._getBuildDeps(packageName, arch);

      /* Step 2 */
      this._resp.log.info(`build src dependencies of ${packageName}`);
      yield this._buildDeps(buildDepsList, arch);

      /* Step 3 */
      this._resp.log.info(`install new build dependencies`);
      yield this._installBuildDeps(buildDepsList, arch, distribution);

      /* Step 4 */
      this._resp.log.info(`get install dependencies of ${packageName}`);
      const installDepsList = Object.keys(
        yield this._getInstallDeps(packageName, arch, distribution)
      );

      /* Step 5 */
      this._resp.log.info(
        `publish install dependencies in ${outputRepository}`
      );

      /* Publish only src packages and the main package. */
      const packageList = installDepsList.map(pkg => `${pkg}-src`);

      let srcPackages = [];
      let startPackage = null;

      if (topPackage) {
        startPackage = `${packageName}-src`;
        srcPackages.push(startPackage);
      } else {
        packageList.push(`${packageName}-src`);
      }

      srcPackages = srcPackages.concat(packageList);
      /* Step 5.5 */
      /* Remove src packages before trying a new build */
      for (const pkg of srcPackages) {
        try {
          const {installed} = yield this._install.status(pkg, distribution);
          if (installed) {
            yield this._remove.package(pkg, distribution, false);
          }
        } catch (ex) {
          this._resp.log.warn(ex);
          /* it doesn't matter, continue... */
        }
      }

      xFs.rm(outputRepository);
      const resDeps = yield this._publishInstallDeps(
        startPackage,
        packageList,
        arch,
        distribution,
        outputRepository
      );

      try {
        /* Step 6 */
        if (!resDeps.skip) {
          this._resp.log.info(`build the src repository for ${distribution}`);
          yield this._buildSrc(null, arch, distribution, outputRepository);
        }
      } finally {
        /* Step 7 */
        if (resDeps.list.length) {
          this._resp.log.info(`unpublish stub packages`);
          yield this._unpublishStub(resDeps.list, distribution, null);
        }
      }
    } catch (ex) {
      throw ex;
    } finally {
      xFs.rm(outputRepository);
    }
  }

  *_tryBuild(packageName, arch, distribution, topPackage) {
    const packageDef = definition.load(
      packageName,
      null,
      this._resp,
      distribution
    );

    if (packageDef.architecture.indexOf('source') === -1) {
      /* Try build every install dependencies. */
      for (const pkg of Build._installList(
        packageDef.dependency.install,
        arch
      )) {
        yield this._tryBuild(pkg, arch, distribution, false);
      }
    } else {
      /* It's a source dependency, begins the whole build. */
      yield this._build(packageName, arch, distribution, topPackage);
    }
  }

  *package(packageRef, distribution) {
    const pkg = utils.parsePkgRef(packageRef);
    distribution = distribution || this._devDistribution;

    this._resp.log.info(
      'Build %s package%s on %s.',
      pkg.name || 'all',
      pkg.name ? '' : 's',
      pkg.arch || 'all architectures'
    );

    if (distribution !== this._devDistribution) {
      yield this._admindir.create(
        packageRef,
        getTargetRoot(distribution, this._resp),
        distribution
      );
    }

    const res = yield this._admindir.create(packageRef, null, null);
    yield this._tryBuild(res.name, res.arch, distribution, true);
  }
}

module.exports = resp => new Build(resp);
