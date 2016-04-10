'use strict';

const path  = require ('path');
const watt  = require ('watt');
const _     = require ('lodash');

const utils      = require ('./utils.js');
const definition = require ('./def.js');
const make       = require ('./make.js');
const clean      = require ('./clean.js');

const xEnv = require ('xcraft-core-env');
const xFs  = require ('xcraft-core-fs');
const wpkg = require ('xcraft-contrib-wpkg');


class Build {
  constructor (response) {
    this._response = response;

    this._admindir = require ('./admindir.js') (response);
    this._install  = require ('./install.js')  (response);
    this._publish  = require ('./publish.js')  (response);

    watt.wrapAll (this);
  }

  /**
   * Call the build function for each build dependencies.
   *
   * It looks for all build dependencies.
   * The src dependencies that are already built, are skipped. But note that
   * the versions are not checked.
   *
   * @param {string} packageName
   * @param {string} arch - Architecture.
   * @param {function(err)} next
   */
  * _buildDeps (packageName, arch, next) {
    const packageDef = definition.load (packageName, null, this._response);
    const list = [];

    /* Extract all dependencies (not recursively). */
    Object
      .keys (packageDef.dependency.build)
      .forEach ((dep) => {
        const depDef = definition.load (dep, null, this._response);

        list.push ({
          type: depDef.architecture.indexOf ('source') === -1 ? 'bin' : 'src',
          name: dep
        });
      });

    /* Build the packages that are not already built. */
    // FIXME: check the package version
    for (const pkg of list) {
      if (pkg.type === 'bin') {
        yield this._tryBuild (pkg.name, arch, false);
        continue;
      }

      /* Only for 'src' type. */
      const deb = yield this._publish.status (pkg.name, null, next);
      if (!deb) {
        yield this._tryBuild (pkg.name, arch, false);
      }
    }
  }

  /**
   * Get all build dependencies.
   *
   * @param {string} packageName
   */
  _getBuildDeps (packageName) {
    const packageDef = definition.load (packageName, null, this._response);
    const list = Object.keys (packageDef.dependency.build);
    return list;
  }

  /**
   * Install all build dependencies.
   *
   * @param {string[]} packagelist - The list of packages to install.
   * @param {string} arch - Architecture.
   * @param {function(err)} next
   */
  * _installBuildDeps (packagelist, arch, next) {
    try {
      for (const pkg of packagelist) {
        yield this._install.package (pkg, false, next);
      }
    } catch (ex) {
      throw ex;
    } finally {
      xEnv.devrootUpdate ();
    }
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
   * @param {string} packageName
   * @param {string} arch - Architecture.
   * @returns {Object[]} the install list.
   */
  * _getInstallDeps (packageName, arch) {
    const packageDef = definition.load (packageName, null, this._response);
    let list = {};

    for (const dep of Object.keys (packageDef.dependency.install)) {
      const depDef = definition.load (dep, null, this._response);

      if (depDef.architecture.indexOf ('source') === -1) {
        throw 'only source package are supported';
      }

      // FIXME: handle the package version
      list[dep] = true;
      const newList = yield this._getInstallDeps (dep, arch);
      _.merge (list, newList);
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
   * @param {string} outputRepository - Location.
   * @param {function} next
   * @returns {string[]} the list of stubs.
   */
  * _publishInstallDeps (packageName, packageList, arch, outputRepository, next) {
    let isEmpty = true;
    const list = [];

    if (packageName) {
      yield this._publish.add (packageName, null, outputRepository, next);
      isEmpty = false;
    }

    for (const pkg of packageList) {
      const packageName = pkg.replace (/-src$/, '');

      /* Check if this package is not already built. */
      // FIXME: handle the package version
      const deb = yield this._publish.status (packageName, null, next);
      if (!deb) {
        yield this._publish.add (pkg, null, outputRepository, next);
        isEmpty = false;
        continue;
      }

      list.push (packageName);
    }

    /* Nothing published, it's useless to build only stubs. */
    if (isEmpty) {
      return {
        skip: true,
        list: []
      };
    }

    for (const packageName of list) {
      const props = definition.load (packageName, null, this._response);
      delete props.data;

      yield clean.temp (packageName, this._response, next);
      yield make.package ('toolchain+stub', arch, utils.flatten (props), outputRepository, this._response, next);
    }

    return {
      skip: false,
      list: list
    };
  }

  /**
   * Build all packages available in the specified repository.
   *
   * The output binary repository is the usual (default) repository.
   *
   * @param {string} packageName
   * @param {string} arch - Architecture.
   * @param {string} repository - Location.
   * @param {function(err)} callback
   */
  _buildSrc (packageName, arch, repository, callback) {
    const name = packageName ? packageName + '-src' : null;
    wpkg.buildFromSrc (name, arch, repository, this._response, callback);
  }

  /**
   * Unpublish the stub package.
   *
   * @param {string[]} list
   * @param {string} repository
   * @param {function(err)} next
   */
  * _unpublishStub (list, repository, next) {
    for (const stub of list) {
      yield this._publish.remove (`${stub}-stub`, repository, next);
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
   * @param {string} packageName
   * @param {string} arch - Architecture.
   * @param {boolean} topPackage
   * @param {function(err)} next
   */
  * _build (packageName, arch, topPackage, next) {
    const xcraftConfig = require ('xcraft-core-etc') (null, this._response).load ('xcraft');

    const outputRepository = path.join (xcraftConfig.tempRoot, 'wpkg-src-staging');

    try {
      /* Step 1 */
      this._response.log.info (`build src dependencies of ${packageName}`);
      yield this._buildDeps (packageName, arch);

      /* Step 2 */
      this._response.log.info (`get build dependencies of ${packageName}`);
      const buildDepsList = this._getBuildDeps (packageName);

      /* Step 3 */
      this._response.log.info (`install new build dependencies`);
      yield this._installBuildDeps (buildDepsList, arch);

      /* Step 4 */
      this._response.log.info (`get install dependencies of ${packageName}`);
      const installDepsList = Object.keys (yield this._getInstallDeps (packageName, arch));

      /* Step 5 */
      this._response.log.info (`publish install dependencies in ${outputRepository}`);

      /* Publish only src packages and the main package. */
      const packageList = installDepsList.map ((pkg) => {
        return `${pkg}-src`;
      });

      let startPackage = null;
      if (topPackage) {
        startPackage = `${packageName}-src`;
      } else {
        packageList.push (`${packageName}-src`);
      }

      xFs.rm (outputRepository);
      const resDeps = yield this._publishInstallDeps (startPackage, packageList, arch, outputRepository);

      /* Step 6 */
      if (!resDeps.skip) {
        this._response.log.info (`build the src repository`);
        yield this._buildSrc (null, arch, outputRepository, next);
      }

      /* Step 7 */
      if (resDeps.list.length) {
        this._response.log.info (`unpublish stub packages`);
        yield this._unpublishStub (resDeps.list, null);
      }
    } catch (ex) {
      throw ex;
    } finally {
      xFs.rm (outputRepository);
    }
  }

  * _tryBuild (packageName, arch, topPackage) {
    const packageDef = definition.load (packageName, null, this._response);

    if (packageDef.architecture.indexOf ('source') === -1) {
      /* Try build every install dependencies. */
      for (const pkg of Object.keys (packageDef.dependency.install)) {
        yield this._tryBuild (pkg, arch, false);
      }
    } else {
      /* It's a source dependency, begins the whole build. */
      yield this._build (packageName, arch, topPackage);
    }
  }

  * package (packageRef) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info ('Build %s package%s on %s.',
                             pkg.name || 'all',
                             pkg.name ? '' : 's',
                             pkg.arch || 'all architectures');

    const res = yield this._admindir.create (packageRef);
    yield this._tryBuild (res.name, res.arch, true);
  }
}

module.exports = (response) => new Build (response);
