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
    this._pkgCfgFileName = pacmanConfig.pkgCfgFileName;

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
      const isExternal = name[0] === '*';
      let _name = name;
      let external;
      if (isExternal) {
        [external, _name] = name.substring(1).split('@');
      }
      if (!state[_name]) {
        state[_name] = [];
      }
      const payload = {
        version: version || '',
        architecture: archs ? archs.split(' ') : [],
      };
      if (external) {
        payload.external = external;
      }
      state[_name].push(payload);
      return state;
    }, {});
  }

  static _pkg2def(pkgControl) {
    const def = Object.assign({}, pkgControl);
    const types = {
      'Architecture': {
        path: 'architecture',
        parser: (arch) => arch.split(' '),
        empty: [],
      },
      'Build-Depends': {
        path: 'dependency.install',
        parser: Build._parseDeps,
        empty: {},
      },
      'Depends': {
        path: 'dependency.install',
        parser: Build._parseDeps,
        empty: {},
      },
      'Package': {
        path: 'name',
        parser: (name) => name.replace(/-src$/, ''),
        empty: '',
      },
      'Version': {
        path: 'version',
        parser: (v) => v,
        empty: '',
      },
      'X-Craft-Build-Depends': {
        path: 'dependency.build',
        parser: Build._parseDeps,
        empty: {},
      },
      'X-Craft-Make-Depends': {
        path: 'dependency.make',
        parser: Build._parseDeps,
        empty: {},
      },
      'X-Craft-Sub-Packages': {
        path: 'subpackage',
        parser: (sub) => sub.split(', '),
        empty: [],
      },
    };

    Object.keys(def)
      .filter((type) => !types[type])
      .forEach((type) => delete def[type]);

    Object.keys(types)
      .filter((type) => !!def[type])
      .forEach((type) => {
        const p = types[type].path.split('.');
        let item, it;
        for (it = def; (item = p.shift()); it = it[item]) {
          if (!p.length) {
            const value =
              def[type] !== 'undefined'
                ? types[type].parser(def[type])
                : types[type].empty;
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
    if (
      !Object.prototype.hasOwnProperty.call(
        this._cachePkgSrcPublishStatus,
        srcPackageName
      )
    ) {
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
          null,
          this._devDistribution,
          next
        );
      }
      return this._cachePkgSrcDef[packageName];
    }
    return yield this._wpkg.show(packageName, arch, null, distribution, next);
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
      yield this._wpkg.show(packageName, arch, null, distribution, next)
    );
  }

  /**
   * Call the build function for each build dependencies.
   *
   * The src dependencies that are already built, are skipped.
   *
   * @yields
   * @param {string} packageList - List of build dependencies.
   * @param {string} arch - Architecture.
   * @param {Function} next - Watt's callback.
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
    const externals = [];
    const internals = Object.keys(buildDeps).filter((name) => {
      if (
        !buildDeps[name].some(
          (dep) => !dep.architecture.length || dep.architecture.includes(arch)
        )
      ) {
        return false;
      }
      if (buildDeps[name].some((dep) => dep.external)) {
        externals.push(`${buildDeps[name][0].external}@${name}`);
        return false;
      }
      return true;
    });
    return {internals, externals};
  }

  /**
   * Get all build dependencies.
   *
   * @yields
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {Function} next - Watt's callback.
   * @returns {string[]} the list of build packages.
   */
  *_getBuildDeps(packageName, arch, next) {
    const packageDef = yield this._getPkgDef(
      packageName,
      arch,
      this._devDistribution,
      next
    );

    let {internals, externals} = Build._buildList(
      packageDef.dependency.build,
      arch
    );

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
      const depList = Build._buildList(depDef.dependency.build, arch);
      internals = internals.concat(depList.internals);
      externals = externals.concat(depList.externals);
    }

    return {
      internals: _.uniq(internals),
      externals: _.uniq(externals),
    };
  }

  /**
   * Install all build dependencies.
   *
   * @yields
   * @param {string[]} packagelist - The list of packages to install.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name.
   * @param {Function} next - Watt's callback.
   */
  *_installBuildDeps(packagelist, arch, distribution, next) {
    try {
      for (const pkg of packagelist) {
        /* It's possible that a "build" dependency comes from an external
         * reposittory. In this case the distribution must be extracted from
         * the package's name.
         */
        const exploded = pkg.split('@');
        const isExternal = exploded.length > 1;
        const distrib = isExternal
          ? distribution || exploded[0]
          : this._devDistribution;
        const name = exploded[1] || pkg;

        if (isExternal) {
          if (distribution && distribution !== exploded[0]) {
            this._resp.log.warn(
              `try to install the external package ${name} that comes from ${exploded[0]}, to the ${distrib} distribution`
            );
          }
          yield this._install.externalPackage(name, distrib, null, false, next);
        } else {
          /* Note that by default the install process skip the same version
           * then this check seems useless. But many validations are done on
           * the package and the target tree and it takes a significant
           * amount of time.
           */
          const def = yield this._getBinPkgDef(name, arch, distrib, next);

          const {version, installed} = yield this._install.status(name, null);
          if (!installed || version !== def.version) {
            yield this._install.package(name, null, null, false, next);
          }
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
   * @yields
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name.
   * @param {Function} next - Watt's callback.
   * @returns {object[]} the install list.
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
   * @yields
   * @param {string} packageName - Main package.
   * @param {string[]} packageList - List of dependencies.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} outputRepository - Location.
   * @param {Function} next - Watt's callback.
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
      let deb = false;
      try {
        deb = yield this._publish.status(packageName, distribution, null);
        if (!deb) {
          const list = [{packageName, arch}];
          if (def.subpackage?.length) {
            list.push(
              ...def.subpackage
                .filter((entry) => entry.indexOf('*') === -1)
                .map((entry) => {
                  const [s, a = arch] = entry.split(':');
                  return {
                    packageName: `${packageName}-${s}`,
                    arch: a,
                  };
                })
            );
          }
          for (const {packageName, arch} of list) {
            yield this._wpkg.copyFromArchiving(
              packageName,
              arch,
              def.version,
              distribution
            );
          }
          deb = yield this._publish.status(packageName, distribution, null);
        }
      } catch (ex) {
        if (ex.code !== 'ENOENT') {
          throw ex;
        }
        this._resp.log.warn(`cannot copy from archive: ${ex.message}`);
      }

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
        null
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
   * @yields
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} repository - Location.
   * @param {Function} next - Watt's callback.
   */
  *_buildSrc(packageName, arch, distribution, repository, next) {
    const name = packageName ? packageName + '-src' : null;
    yield this._wpkg.buildFromSrc(name, arch, repository, distribution, next);
  }

  /**
   * Unpublish the stub package.
   *
   * @yields
   * @param {string[]} list - List of packages.
   * @param {string} [distribution] - Distribution's name or null.
   * @param {string} [repository] - Location.
   */
  *_unpublishStub(list, distribution, repository) {
    const xcraftConfig = require('xcraft-core-etc')().load('xcraft');
    const xUtils = require('xcraft-core-utils');
    const _list = [];

    list.forEach((pkg) => {
      const def = xUtils.yaml.fromFile(
        path.join(xcraftConfig.pkgProductsRoot, pkg, this._pkgCfgFileName)
      );
      if (def.subpackage) {
        _list.push(
          ...def.subpackage
            .filter((sub) => sub.indexOf('*') === -1)
            .map((sub) => ({
              sub: sub.replace(/:.*/, ''),
              arch: sub.indexOf(':') !== -1 ? sub.replace(/.*:/, '') : '',
            }))
            .map(
              ({sub, arch}) => `${pkg}-${sub}-stub` + (arch ? `:${arch}` : '')
            )
        );
      }
      _list.push(`${pkg}-stub`);
    });

    yield this._publish.removeAll(_list, repository, distribution);
  }

  *_unpublish(packageName, distribution) {
    try {
      yield this._publish.remove(packageName, null, distribution, true);
    } catch (ex) {
      this._resp.log.warn(ex);
      /* it doesn't matter, continue... */
    }
  }

  /**
   * Main build function.
   *
   * This function tries to handle all build cases.
   * For example:
   * - Packages with src build dependencies.
   * - Packages with src install dependencies.
   *
   * @yields
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
      const buildDeps = yield this._getBuildDeps(packageName, arch);

      /* Step 2 */
      if (process.env.PEON_DEBUG_PKG !== packageName) {
        this._resp.log.info(`build src dependencies of ${packageName}`);
        yield this._buildDeps(buildDeps.internals, arch);
      }

      /* Step 3 */
      this._resp.log.info(`install new build dependencies`);
      yield this._installBuildDeps(
        buildDeps.internals.concat(buildDeps.externals),
        arch,
        distribution
      );

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

      /* Step 5.8 */
      let prevInstallDepsList = [];
      if (!resDeps.skip) {
        /* The goal here is to prevent impossible graph resolutions because multiple
         * versions of a same package will exist in the output repository.
         * The wpkg resolver is just not smart enough in some corner cases.
         */
        this._resp.log.info(
          `unpublish previous (non-stub) install dependencies of ${distribution}`
        );
        prevInstallDepsList = installDepsList.filter(
          (pkg) => !resDeps.list.includes(pkg)
        );
        for (const pkg of prevInstallDepsList) {
          try {
            const info = yield this._showPackage(
              `${pkg}-src`,
              arch,
              this._devDistribution
            );
            if (info['X-Craft-Sub-Packages'] !== 'undefined') {
              const subPackages = info['X-Craft-Sub-Packages']
                .split(', ')
                .map((sub) => `${pkg}-${sub}`);
              for (const subPkg of subPackages) {
                yield this._unpublish(subPkg, distribution);
              }
            }
            yield this._unpublish(pkg, distribution);
          } catch (ex) {
            this._resp.log.warn(ex);
            /* it doesn't matter, continue... */
          }
        }
      }

      try {
        /* Step 6 */
        if (!resDeps.skip) {
          this._resp.log.info(`build the src repository for ${distribution}`);
          yield this._buildSrc(null, arch, distribution, outputRepository);
        }
      } catch (ex) {
        /* Something has failed, then (maybe) you must restore yourself the
         * previous versions (see step 5.8). Note that it's better to fix the
         * build instead. Nevertheless, look at the archives (wpkg@ver) for
         * all previous builds.
         *
         * FIXME: implement auto-recovery
         */
        this._resp.log.err(
          `because the build has failed, you must restore (by hand, if you want) previous versions of ${prevInstallDepsList.join(
            ', '
          )} for ${distribution}`
        );
        throw ex;
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
      xFs.rm(path.join(outputRepository, '../wpkg@ver'));
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
        'ensure that all build dependencies are built when using zeroBuild'
      );
    }

    if (packageDef.architecture.indexOf('source') === -1) {
      if (process.env.PEON_DEBUG_PKG === packageName) {
        throw new Error('zeroBuild is supported only with a source package');
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
