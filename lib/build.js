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

  static _parseDeps(deps) {
    return deps.split(', ').reduce((state, dep) => {
      const matches = dep.match(
        /([^ ()[\]]+)(?: \(([^)]+)\))?(?: \[([^\]]+)\])?/
      );
      const [, name, version, archs] = matches;
      const external = name[0] === '*';
      const _name = external ? name.substring(1) : name;
      if (!state[_name]) {
        state[_name] = [];
      }
      state[_name].push({
        version: version || '',
        architecture: archs ? archs.split(' ') : [],
      });
      if (external) {
        state[_name].external = true;
      }
      return state;
    }, {});
  }

  static _pkg2def(pkgControl) {
    const def = Object.assign({}, pkgControl);
    const types = {
      'Architecture': {
        path: 'architecture',
        parser: (arch) => arch.split(' '),
      },
      'Build-Depends': {
        path: 'dependency.install',
        parser: Build._parseDeps,
      },
      'Depends': {
        path: 'dependency.install',
        parser: Build._parseDeps,
      },
      'Package': {
        path: 'name',
        parser: (name) => name.replace(/-src$/, ''),
      },
      'Version': {
        path: 'version',
        parser: (v) => v,
      },
      'X-Craft-Build-Depends': {
        path: 'dependency.build',
        parser: Build._parseDeps,
      },
      'X-Craft-Make-Depends': {
        path: 'dependency.make',
        parser: Build._parseDeps,
      },
    };

    Object.keys(types)
      .filter((type) => !!def[type])
      .forEach((type) => {
        const p = types[type].path.split('.');
        let item, it;
        for (it = def; (item = p.shift()); it = it[item]) {
          if (!p.length) {
            const value =
              def[type] !== 'undefined' ? types[type].parser(def[type]) : {};
            if (it[item]) {
              Object.assign(it[item], value);
            } else {
              it[item] = value;
            }
            delete def[type];
            return;
          }
          if (!it[item]) {
            it[item] = {};
          }
        }
      });

    return def;
  }

  *_getSrcPublishedStatus(packageName, distribution) {
    const srcPackageName = `${packageName}-src`;
    if (!this._cachePkgSrcPublishStatus[srcPackageName]) {
      this._cachePkgSrcPublishStatus[
        srcPackageName
      ] = yield this._publish.status(srcPackageName, distribution, null);
    }
    return this._cachePkgSrcPublishStatus[srcPackageName];
  }

  *_showPackage(packageName, arch, distribution, next) {
    if (packageName.endsWith('-src')) {
      if (!this._cachePkgSrcDef[packageName]) {
        this._cachePkgSrcDef[packageName] = yield this._wpkg.show(
          packageName,
          arch,
          this._devDistribution,
          next
        );
      }
      return this._cachePkgSrcDef[packageName];
    }
    return yield this._wpkg.show(packageName, arch, distribution, next);
  }

  *_getPkgDef(packageName, arch, distribution, next) {
    const pkgDef = definition.getBasePackageDef(packageName, this._resp);
    packageName = pkgDef.name;
    const status = yield this._getSrcPublishedStatus(packageName, distribution);
    const pkg = status ? `${packageName}-src` : packageName;
    const distrib = status ? this._devDistribution : distribution;
    return Build._pkg2def(yield this._showPackage(pkg, arch, distrib, next));
  }

  *_getBinPkgDef(packageName, arch, distribution, next) {
    return Build._pkg2def(
      yield this._wpkg.show(packageName, arch, distribution, next)
    );
  }

  /**
   * Call the build function for each build dependencies.
   *
   * The src dependencies that are already built, are skipped.
   *
   * @param {string} packageList - List of build dependencies.
   * @param {string} arch - Architecture.
   * @param {function} next - Watt's callback.
   */
  *_buildDeps(packageList, arch, next) {
    const list = [];

    /* Extract all dependencies (not recursively). */
    for (const dep of packageList) {
      const depDef = yield this._getPkgDef(
        dep,
        arch,
        this._devDistribution,
        next
      );

      list.push({
        type: depDef.architecture.indexOf('source') === -1 ? 'bin' : 'src',
        name: dep,
        version: depDef.version,
      });
    }

    /* Build the packages that are not already built. */
    for (const pkg of list) {
      if (pkg.type === 'bin') {
        yield this._tryBuild(pkg.name, arch, this._devDistribution, false);
        continue;
      }

      /* Only for 'src' type. */
      const deb = yield this._publish.status(pkg.name, null, null);
      if (!deb || deb.version !== pkg.version) {
        yield this._tryBuild(pkg.name, arch, this._devDistribution, false);
      }
    }
  }

  static _buildList(buildDeps, arch) {
    return Object.keys(buildDeps).filter((name) =>
      buildDeps[name].some(
        (dep) => !dep.architecture.length || dep.architecture.includes(arch)
      )
    );
  }

  /**
   * Get all build dependencies.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {function} next - Watt's callback.
   * @returns {string[]} the list of build packages.
   */
  *_getBuildDeps(packageName, arch, next) {
    const packageDef = yield this._getPkgDef(
      packageName,
      arch,
      this._devDistribution,
      next
    );

    let list = Build._buildList(packageDef.dependency.build, arch);

    const installDepsList = Object.keys(
      yield this._getInstallDeps(packageName, arch, this._devDistribution)
    );

    for (const dep of installDepsList) {
      const depDef = yield this._getPkgDef(
        dep,
        arch,
        this._devDistribution,
        next
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
   * @param {function} next - Watt's callback.
   */
  *_installBuildDeps(packagelist, arch, distribution, next) {
    try {
      for (const pkg of packagelist) {
        /* Note that by default the install process skip the same version
         * then this check seems useless. But many validations are done on
         * the package and the target tree and it takes a significant
         * amount of time.
         */
        const def = yield this._getBinPkgDef(
          pkg,
          arch,
          this._devDistribution,
          next
        );

        const {version, installed} = yield this._install.status(pkg, null);
        if (!installed || version !== def.version) {
          yield this._install.package(pkg, null, null, false, next);
        }
      }
    } finally {
      xEnv.devrootUpdate(distribution);
    }
  }

  static _installList(installDeps, arch) {
    return Object.keys(installDeps).filter((name) =>
      installDeps[name].some(
        (dep) => !dep.architecture.length || dep.architecture.includes(arch)
      )
    );
  }

  /**
   * Get all install dependencies recursively.
   *
   * It returns a list of all 'src' dependencies recursively in all packages.
   *
   * The goal is to use this list with wpkg. Then it's the wpkg responsability
   * to resolve the dependencies.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name.
   * @param {function} next - Watt's callback.
   * @returns {Object[]} the install list.
   */
  *_getInstallDeps(packageName, arch, distribution, next) {
    const packageDef = yield this._getPkgDef(
      packageName,
      arch,
      distribution,
      next
    );
    let list = {};

    for (const dep of Build._installList(packageDef.dependency.install, arch)) {
      const depDef = yield this._getPkgDef(dep, arch, distribution, next);

      if (depDef.architecture.indexOf('source') === -1) {
        throw new Error('only source package are supported');
      }

      // FIXME: handle the package version
      list[depDef.name] = true;
      const newList = yield this._getInstallDeps(
        depDef.name,
        arch,
        distribution
      );
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
   * @param {string[]} packageList - List of dependencies.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} outputRepository - Location.
   * @param {function} next - Watt's callback.
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

      const def = yield this._getPkgDef(packageName, arch, distribution, next);

      /* Check if this package is not already built. */
      const deb = yield this._publish.status(packageName, distribution, null);
      if (!deb || deb.version !== def.version) {
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
      props.dependency = {};

      this._clean.temp(packageName);
      yield this._make.package(
        'xcraft+stub',
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
   * @param {function} next - Watt's callback.
   */
  *_buildSrc(packageName, arch, distribution, repository, next) {
    const name = packageName ? packageName + '-src' : null;
    yield this._wpkg.buildFromSrc(name, arch, repository, distribution, next);
  }

  /**
   * Unpublish the stub package.
   *
   * @param {string[]} list - List of packages.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} repository - Location.
   */
  *_unpublishStub(list, distribution, repository) {
    const xcraftConfig = require('xcraft-core-etc')().load('xcraft');
    const xUtils = require('xcraft-core-utils');
    const _list = [];

    list.forEach((pkg) => {
      const def = xUtils.yaml.fromFile(
        path.join(xcraftConfig.pkgProductsRoot, pkg, 'config.yaml')
      );
      if (def.subpackage) {
        _list.push(
          ...def.subpackage
            .filter((sub) => sub.indexOf('*') === -1)
            .map((sub) => sub.replace(/:.*/, ''))
            .map((sub) => `${pkg}-${sub}-stub`)
        );
      }
      _list.push(`${pkg}-stub`);
    });

    yield this._publish.removeAll(_list, repository, distribution);
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
   * @param {boolean} topPackage - Initial package provided by pacman.build.
   */
  *_build(packageName, arch, distribution, topPackage) {
    const xcraftConfig = require('xcraft-core-etc')(null, this._resp).load(
      'xcraft'
    );

    const outputRepository = path.join(
      xcraftConfig.tempRoot,
      'wpkg-src-staging'
    );

    let err = null;

    try {
      /* Step 1 */
      this._resp.log.info(`get build dependencies of ${packageName}`);
      const buildDepsList = yield this._getBuildDeps(packageName, arch);

      /* Step 2 */
      if (process.env.PEON_DEBUG_PKG !== packageName) {
        this._resp.log.info(`build src dependencies of ${packageName}`);
        yield this._buildDeps(buildDepsList, arch);
      }

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
      const packageList = installDepsList.map((pkg) => `${pkg}-src`);

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
          try {
            yield this._unpublishStub(resDeps.list, distribution, null);
          } catch (ex) {
            err = ex;
          }
        }
      }
    } finally {
      xFs.rm(outputRepository);
    }

    if (err && err !== 'package not found') {
      throw err;
    }
  }

  *_tryBuild(packageName, arch, distribution, topPackage, next) {
    const packageDef = yield this._getPkgDef(
      packageName,
      arch,
      distribution,
      next
    );

    if (process.env.PEON_DEBUG_PKG === packageName && !topPackage) {
      throw new Error(
        'ensure that all build dependencies are built when using zero-build'
      );
    }

    if (packageDef.architecture.indexOf('source') === -1) {
      if (process.env.PEON_DEBUG_PKG === packageName) {
        throw new Error('zero-build is supported only with a source package');
      }

      /* Try build every install dependencies. */
      for (const pkg of Build._installList(
        packageDef.dependency.install,
        arch
      )) {
        const key = `${pkg}-${arch}-${distribution}`;
        if (this._cachePkgTriedList[key]) {
          continue;
        }
        this._cachePkgTriedList[key] = true;
        yield this._tryBuild(pkg, arch, distribution, false);
      }
    } else {
      /* It's a source dependency, begins the whole build. */
      yield this._build(packageName, arch, distribution, topPackage);
    }
  }

  *package(packageRef, distribution, next) {
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

    try {
      this._cachePkgTriedList = {};
      this._cachePkgSrcPublishStatus = {};
      this._cachePkgSrcDef = {};

      yield this._tryBuild(res.name, res.arch, distribution, true);
    } finally {
      this._cachePkgTriedList = {};
      this._cachePkgSrcPublishStatus = {};
      this._cachePkgSrcDef = {};
    }
  }
}

module.exports = (resp) => new Build(resp);
