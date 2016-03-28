'use strict';

const moduleName = 'pacman/build';

const path  = require ('path');
const async = require ('async');
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
 * @param {function(err, list)} callback - List of stubs.
 */
function publishInstallDeps (packageName, packageList, arch, outputRepository, callback) {
  const list = [];

  async.series ([
    function (callback) {
      if (!packageName) {
        callback ();
        return;
      }

      publish.add (packageName, null, outputRepository, callback);
    },

    function (callback) {
      async.eachSeries (packageList, (pkg, callback) => {
        const packageName = pkg.replace (/-src$/, '');

        /* Check if this package is already built. */
        // FIXME: handle the package version
        publish.status (packageName, null, (err, deb) => {
          if (!deb) {
            publish.add (pkg, null, outputRepository, callback);
            return;
          }

          const props = definition.load (packageName);
          delete props.data;

          clean.temp (packageName, (err) => {
            if (err) {
              callback (err);
              return;
            }

            list.push (packageName);
            make.package ('toolchain+stub', arch, utils.flatten (props), outputRepository, callback);
          });
        });
      }, callback);
    }
  ], (err) => callback (err, list));
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
  async.auto ({
    buildDeps: (callback) => {
      xLog.info (`build src dependencies of ${packageName}`);
      buildDeps (packageName, arch, tryBuild, callback);
    },

    getBuildDeps: ['buildDeps', (callback) => {
      xLog.info (`get build dependencies of ${packageName}`);
      getBuildDeps (packageName, arch, callback);
    }],

    installBuildDeps: ['getBuildDeps', (callback, res) => {
      xLog.info (`install new build dependencies`);
      installBuildDeps (res.getBuildDeps, arch, callback);
    }],

    getInstallDeps: ['installBuildDeps', (callback) => {
      xLog.info (`get install dependencies of ${packageName}`);
      getInstallDeps (packageName, arch, (err, list) => {
        if (err) {
          callback (err);
          return;
        }

        callback (null, Object.keys (list));
      });
    }],

    publishInstallDeps: ['getInstallDeps', (callback, res) => {
      const outputRepository = path.join (xcraftConfig.tempRoot, 'wpkg-src-staging');
      xFs.rm (outputRepository);

      xLog.info (`publish install dependencies in ${outputRepository}`);

      /* Publish only src packages and the main package. */
      const packageList = res.getInstallDeps.map ((pkg) => {
        return `${pkg}-src`;
      });

      let startPackage = null;
      if (topPackage) {
        startPackage = `${packageName}-src`;
      } else {
        packageList.push (`${packageName}-src`);
      }

      publishInstallDeps (startPackage, packageList, arch, outputRepository, (err, list) => {
        if (err) {
          callback (err);
          return;
        }

        callback (null, {
          repository: outputRepository,
          stubList:   list
        });
      });
    }],

    buildSrc: ['publishInstallDeps', (callback, res) => {
      xLog.info (`build the src repository`);
      buildSrc (null, arch, res.publishInstallDeps.repository, callback);
    }],

    unpublishStub: ['buildSrc', (callback, res) => {
      xLog.info (`unpublish stub packages`);
      if (res.publishInstallDeps.stubList.length) {
        unpublishStub (res.publishInstallDeps.stubList, null, callback);
      } else {
        callback ();
      }
    }]
  }, (err, res) => {
    if (res.publishInstallDeps && res.publishInstallDeps.repository) {
      xFs.rm (res.publishInstallDeps.repository);
    }
    callback (err);
  });
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
