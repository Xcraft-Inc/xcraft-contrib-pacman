'use strict';

const moduleName = 'pacman/build';

const path  = require ('path');
const async = require ('async');
const watt  = require ('watt');
const _     = require ('lodash');

const utils      = require ('./utils.js');
const admindir   = require ('./admindir.js');
const definition = require ('./def.js');
const install    = require ('./install.js');
const publish    = require ('./publish.js');
const make       = require ('./make.js');
const clean      = require ('./clean.js');

const xLog         = require ('xcraft-core-log') (moduleName);
const xEnv         = require ('xcraft-core-env');
const xFs          = require ('xcraft-core-fs');
const xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
const wpkg         = require ('xcraft-contrib-wpkg');


/**
 * Call the build function for each build dependencies.
 *
 * It looks for all build dependencies.
 * The src dependencies that are already built, are skipped. But note that
 * the versions are not checked.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function} tryBuild - Main build func.
 * @param {function(err)} callback
 */
function buildDeps (packageName, arch, tryBuild, callback) {
  const packageDef = definition.load (packageName);
  const list = [];

  /* Extract all dependencies (not recursively). */
  Object
    .keys (packageDef.dependency.build)
    .forEach ((dep) => {
      const depDef = definition.load (dep);

      list.push ({
        type: depDef.architecture.indexOf ('source') === -1 ? 'bin' : 'src',
        name: dep
      });
    });

  /* Build the packages that are not already built. */
  // FIXME: check the package version
  async.eachSeries (list, (pkg, callback) => {
    if (pkg.type === 'bin') {
      tryBuild (pkg.name, arch, false, callback);
      return;
    }

    /* Only for 'src' type. */
    publish.status (pkg.name, null, (err, deb) => {
      if (err) {
        callback (err);
        return;
      }

      if (!deb) {
        tryBuild (pkg.name, arch, false, callback);
      } else {
        callback ();
      }
    });
  }, callback);
}

/**
 * Get all build dependencies.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function(err, list)} callback - Returns the build list.
 */
function getBuildDeps (packageName, arch, callback) {
  const packageDef = definition.load (packageName);
  const list = Object.keys (packageDef.dependency.build);
  callback (null, list);
}

/**
 * Install all build dependencies.
 *
 * @param {string[]} packagelist - The list of packages to install.
 * @param {string} arch - Architecture.
 * @param {function(err)} callback
 */
function installBuildDeps (packagelist, arch, callback) {
  async.eachSeries (packagelist, (pkg, callback) => {
    install.package (pkg, false, callback);
  }, (err) => {
    xEnv.devrootUpdate ();
    callback (err);
  });
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
 * @param {function(err, list)} callback - Returns the install list.
 */
function getInstallDeps (packageName, arch, callback) {
  const packageDef = definition.load (packageName);
  let list = {};

  async.eachSeries (Object.keys (packageDef.dependency.install), (dep, callback) => {
    const depDef = definition.load (dep);

    if (depDef.architecture.indexOf ('source') === -1) {
      throw 'only source package are supported';
    }

    // FIXME: handle the package version
    list[dep] = true;
    getInstallDeps (dep, arch, (err, newList) => {
      _.merge (list, newList);
      callback ();
    });
  }, (err) => {
    if (err) {
      callback (err);
      return;
    }

    callback (null, list);
  });
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
const publishInstallDeps = watt (function * (packageName, packageList, arch, outputRepository, next) {
  const list = [];

  if (packageName) {
    yield publish.add (packageName, null, outputRepository, next);
  }

  for (const pkg of packageList) {
    const packageName = pkg.replace (/-src$/, '');

    /* Check if this package is already built. */
    // FIXME: handle the package version
    const deb = yield publish.status (packageName, null, next);
    if (!deb) {
      yield publish.add (pkg, null, outputRepository, next);
      continue;
    }

    const props = definition.load (packageName);
    delete props.data;

    yield clean.temp (packageName, next);

    list.push (packageName);
    yield make.package ('toolchain+stub', arch, utils.flatten (props), outputRepository, next);
  }

  return list;
});

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
function buildSrc (packageName, arch, repository, callback) {
  const name = packageName ? packageName + '-src' : null;
  wpkg.buildFromSrc (name, arch, repository, callback);
}

/**
 * Unpublish the stub package.
 *
 * @param {string[]} list
 * @param {string} repository
 * @param {function(err)} callback
 */
function unpublishStub (list, repository, callback) {
  async.eachSeries (list, (stub, callback) => {
    publish.remove (`${stub}-stub`, repository, callback);
  }, callback);
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
 * @param {function} tryBuild
 * @param {function(err)} callback
 */
function build (packageName, arch, topPackage, tryBuild, callback) {
  const outputRepository = path.join (xcraftConfig.tempRoot, 'wpkg-src-staging');

  watt (function * (next) {
    /* Step 1 */
    xLog.info (`build src dependencies of ${packageName}`);
    yield buildDeps (packageName, arch, tryBuild, next);

    /* Step 2 */
    xLog.info (`get build dependencies of ${packageName}`);
    const buildDepsList = yield getBuildDeps (packageName, arch, next);

    /* Step 3 */
    xLog.info (`install new build dependencies`);
    yield installBuildDeps (buildDepsList, arch, next);

    /* Step 4 */
    xLog.info (`get install dependencies of ${packageName}`);
    const installDepsList = Object.keys (yield getInstallDeps (packageName, arch, next));

    /* Step 5 */
    xLog.info (`publish install dependencies in ${outputRepository}`);

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
    const stubDeps = {
      repository: outputRepository,
      list: yield publishInstallDeps (startPackage, packageList, arch, outputRepository)
    };

    /* Step 6 */
    xLog.info (`build the src repository`);
    yield buildSrc (null, arch, stubDeps.repository, next);

    /* Step 7 */
    xLog.info (`unpublish stub packages`);
    if (stubDeps.list.length) {
      yield unpublishStub (stubDeps.list, null, next);
    }
  }, (err) => {
    xFs.rm (outputRepository);
    callback (err);
  }) ();
}

function tryBuild (packageName, arch, topPackage, callback) {
  const packageDef = definition.load (packageName);

  if (packageDef.architecture.indexOf ('source') === -1) {
    /* Try build every install dependencies. */
    async.eachSeries (Object.keys (packageDef.dependency.install), (pkg, callback) => {
      tryBuild (pkg, arch, false, callback);
    }, callback);
  } else {
    /* It's a source dependency, begins the whole build. */
    build (packageName, arch, topPackage, tryBuild, callback);
  }
}

exports.package = function (packageRef, callback) {
  const pkg = utils.parsePkgRef (packageRef);

  xLog.info ('Build %s package%s on %s.',
             pkg.name || 'all',
             pkg.name ? '' : 's',
             pkg.arch || 'all architectures');

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    tryBuild (packageName, arch, true, callback);
  });
};
