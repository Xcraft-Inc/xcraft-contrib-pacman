'use strict';

const path  = require ('path');
const watt  = require ('watt');
const _     = require ('lodash');

const utils      = require ('./utils.js');
const admindir   = require ('./admindir.js');
const definition = require ('./def.js');
const install    = require ('./install.js');
const publish    = require ('./publish.js');
const make       = require ('./make.js');
const clean      = require ('./clean.js');

const xEnv         = require ('xcraft-core-env');
const xFs          = require ('xcraft-core-fs');
const wpkg         = require ('xcraft-contrib-wpkg');


let tryBuild = null;

/**
 * Call the build function for each build dependencies.
 *
 * It looks for all build dependencies.
 * The src dependencies that are already built, are skipped. But note that
 * the versions are not checked.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {Object} response
 * @param {function(err)} next
 */
const buildDeps = watt (function * (packageName, arch, response, next) {
  const packageDef = definition.load (packageName, null, response);
  const list = [];

  /* Extract all dependencies (not recursively). */
  Object
    .keys (packageDef.dependency.build)
    .forEach ((dep) => {
      const depDef = definition.load (dep, null, response);

      list.push ({
        type: depDef.architecture.indexOf ('source') === -1 ? 'bin' : 'src',
        name: dep
      });
    });

  /* Build the packages that are not already built. */
  // FIXME: check the package version
  for (const pkg of list) {
    if (pkg.type === 'bin') {
      yield tryBuild (pkg.name, arch, false, response);
      continue;
    }

    /* Only for 'src' type. */
    const deb = yield publish.status (pkg.name, null, response, next);
    if (!deb) {
      yield tryBuild (pkg.name, arch, false, response);
    }
  }
});

/**
 * Get all build dependencies.
 *
 * @param {string} packageName
 */
function getBuildDeps (packageName, response) {
  const packageDef = definition.load (packageName, null, response);
  const list = Object.keys (packageDef.dependency.build);
  return list;
}

/**
 * Install all build dependencies.
 *
 * @param {string[]} packagelist - The list of packages to install.
 * @param {string} arch - Architecture.
 * @param {Object} response
 * @param {function(err)} next
 */
const installBuildDeps = watt (function * (packagelist, arch, response, next) {
  try {
    for (const pkg of packagelist) {
      yield install.package (pkg, false, response, next);
    }
  } catch (ex) {
    throw ex;
  } finally {
    xEnv.devrootUpdate ();
  }
});

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
 * @param {Object} response
 * @returns {Object[]} the install list.
 */
const getInstallDeps = watt (function * (packageName, arch, response) {
  const packageDef = definition.load (packageName, null, response);
  let list = {};

  for (const dep of Object.keys (packageDef.dependency.install)) {
    const depDef = definition.load (dep, null, response);

    if (depDef.architecture.indexOf ('source') === -1) {
      throw 'only source package are supported';
    }

    // FIXME: handle the package version
    list[dep] = true;
    const newList = yield getInstallDeps (dep, arch);
    _.merge (list, newList);
  }

  return list;
});

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
 * @param {Object} response
 * @param {function} next
 * @returns {string[]} the list of stubs.
 */
const publishInstallDeps = watt (function * (packageName, packageList, arch, outputRepository, response, next) {
  let isEmpty = true;
  const list = [];

  if (packageName) {
    yield publish.add (packageName, null, outputRepository, response, next);
    isEmpty = false;
  }

  for (const pkg of packageList) {
    const packageName = pkg.replace (/-src$/, '');

    /* Check if this package is not already built. */
    // FIXME: handle the package version
    const deb = yield publish.status (packageName, null, response, next);
    if (!deb) {
      yield publish.add (pkg, null, outputRepository, response, next);
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
    const props = definition.load (packageName, null, response);
    delete props.data;

    yield clean.temp (packageName, next);
    yield make.package ('toolchain+stub', arch, utils.flatten (props), outputRepository, response, next);
  }

  return {
    skip: false,
    list: list
  };
});

/**
 * Build all packages available in the specified repository.
 *
 * The output binary repository is the usual (default) repository.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {string} repository - Location.
 * @param {Object} response
 * @param {function(err)} callback
 */
function buildSrc (packageName, arch, repository, response, callback) {
  const name = packageName ? packageName + '-src' : null;
  wpkg.buildFromSrc (name, arch, repository, response, callback);
}

/**
 * Unpublish the stub package.
 *
 * @param {string[]} list
 * @param {string} repository
 * @param {Object} response
 * @param {function(err)} next
 */
const unpublishStub = watt (function * (list, repository, response, next) {
  for (const stub of list) {
    yield publish.remove (`${stub}-stub`, repository, response, next);
  }
});

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
 * @param {Object} response
 * @param {function(err)} next
 */
const build = watt (function * (packageName, arch, topPackage, response, next) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');

  const outputRepository = path.join (xcraftConfig.tempRoot, 'wpkg-src-staging');

  try {
    /* Step 1 */
    response.log.info (`build src dependencies of ${packageName}`);
    yield buildDeps (packageName, arch, response);

    /* Step 2 */
    response.log.info (`get build dependencies of ${packageName}`);
    const buildDepsList = getBuildDeps (packageName, response);

    /* Step 3 */
    response.log.info (`install new build dependencies`);
    yield installBuildDeps (buildDepsList, arch, response);

    /* Step 4 */
    response.log.info (`get install dependencies of ${packageName}`);
    const installDepsList = Object.keys (yield getInstallDeps (packageName, arch));

    /* Step 5 */
    response.log.info (`publish install dependencies in ${outputRepository}`);

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
    const resDeps = yield publishInstallDeps (startPackage, packageList, arch, outputRepository, response);

    /* Step 6 */
    if (!resDeps.skip) {
      response.log.info (`build the src repository`);
      yield buildSrc (null, arch, outputRepository, response, next);
    }

    /* Step 7 */
    if (resDeps.list.length) {
      response.log.info (`unpublish stub packages`);
      yield unpublishStub (resDeps.list, null, response);
    }
  } catch (ex) {
    throw ex;
  } finally {
    xFs.rm (outputRepository);
  }
});

tryBuild = watt (function * (packageName, arch, topPackage, response) {
  const packageDef = definition.load (packageName, null, response);

  if (packageDef.architecture.indexOf ('source') === -1) {
    /* Try build every install dependencies. */
    for (const pkg of Object.keys (packageDef.dependency.install)) {
      yield tryBuild (pkg, arch, false, response);
    }
  } else {
    /* It's a source dependency, begins the whole build. */
    yield build (packageName, arch, topPackage, response);
  }
});

exports.package = function (packageRef, response, callback) {
  const pkg = utils.parsePkgRef (packageRef);

  response.log.info ('Build %s package%s on %s.',
                     pkg.name || 'all',
                     pkg.name ? '' : 's',
                     pkg.arch || 'all architectures');

  admindir.create (packageRef, response, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    tryBuild (packageName, arch, true, response, callback);
  });
};
