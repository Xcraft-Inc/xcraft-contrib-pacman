'use strict';

var moduleName = 'pacman/build';

var async = require ('async');
var _     = require ('lodash');

var utils      = require ('./utils.js');
var admindir   = require ('./admindir.js');
var definition = require ('./def.js');
const install  = require ('./install.js');
const publish  = require ('./publish.js');

var xLog         = require ('xcraft-core-log') (moduleName);
var xEnv         = require ('xcraft-core-env');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var wpkg         = require ('xcraft-contrib-wpkg');

/*
function getBuildDeps (packageName) {
  const packageDef = definition.load (packageName);
  let list = {
    bin: {},
    src: {}
  };

  Object
    .keys (packageDef.dependency.build)
    .forEach ((dep) => {
      const depDef = definition.load (dep);
      let type = 'bin';

      if (depDef.architecture.indexOf ('source') !== -1) {
        type = 'src';
      }

      list[type][dep] = true;
      _.merge (list, getBuildDeps (dep));
    });

  return list;
}
*/
/*
function getInstallDeps (packageName) {
  const packageDef = definition.load (packageName);
  let list = {};

  Object
    .keys (packageDef.dependency.install)
    .forEach ((dep) => {
      const depDef = definition.load (dep);

      if (depDef.architecture.indexOf ('source') === -1) {
        throw 'only source package are supported';
      }

      list[dep] = true;
      _.merge (list, getInstallDeps (dep));
    });
}
*/
// getAllInstallDeps (getBuildDeps ('bootstrap').src);
/*
function getAllInstallDeps (packageList) {
  let list = {};

  Object
    .keys (packageList)
    .forEach ((pkg) => {
      _.merge (list, getInstallDeps (pkg));
    });
}
*/

/*
 * const srcBuildDeps = getBuildDeps ('bootstrap').src;
 * const srcInstallDeps = getAllInstallDeps (srcBuildDeps);
 * const pkgs = _.merge (srcBuildDeps, srcInstallDeps);
 * pkgs
 *   .forEach ((pkg) => {
 *     publish.package (pkg, 'tmp/rep');
 *   });
 */

var build = function (packageName, arch, callback) {
  async.auto ({
    listSources: function (callback) {
      if (packageName) {
        /* Just one package... */
        var pkg = {};
        pkg[packageName] = '';

        callback (null, pkg);
      } else {
        var repositoryPath = xcraftConfig.pkgDebRoot;

        /* Retrieve the list of all source packages. */
        wpkg.listIndexPackages (repositoryPath, arch, {
          distrib: 'sources'
        }, callback);
      }
    },

    /* Retrieve the list of all build dependencies. */
    listDeps: ['listSources', function (callback, results) {
      var deps = {};

      Object.keys (results.listSources).forEach (function (name) {
        var packageDef = null;
        try {
          packageDef = definition.load (name);
        } catch (ex) {
          return;
        }

        xLog.verb ('from package %s: %s',
                   name, JSON.stringify (packageDef.dependency.build));
        _.merge (deps, packageDef.dependency.build);
      });

      xLog.verb ('list of build dependencies: ' + JSON.stringify (deps));
      callback (null, deps);
    }],

    /* Install all build dependencies. */
    installDeps: ['listDeps', function (callback, results) {
      async.eachSeries (Object.keys (results.listDeps), function (name, callback) {
        wpkg.install (name, arch, false, callback);
      }, function (err) {
        xEnv.devrootUpdate ();
        callback (err);
      });
    }],

    /* Build one or all packages of the source repository. */
    buildFromSrc: ['installDeps', function (callback) {
      var name = packageName ? packageName + '-src' : null;
      wpkg.buildFromSrc (name, arch, pacmanConfig.pkgToolchainRepository, callback);
    }]
  }, callback);
};

exports.package = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.info ('Build %s package%s on %s.',
             pkg.name || 'all',
             pkg.name ? '' : 's',
             pkg.arch || 'all architectures');

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    build (packageName, arch, callback);
  });
};

function buildSrcDeps (packageName, arch, callback) {
  const packageDef = definition.load (packageName);
  const list = [];

  /* Extract all src dependencies (not recursively). */
  Object
    .keys (packageDef.dependency.build)
    .forEach ((dep) => {
      const depDef = definition.load (dep);

      if (depDef.architecture.indexOf ('source') === -1) {
        return;
      }

      list.push (dep);
    });

  /* Build the src packages that are not already built. */
  // TODO: add version
  async.eachSeries (list, (pkg, callback) => {
    publish.status (pkg, null, (err, deb) => {
      if (err) {
        callback (err);
        return;
      }

      if (!deb) {
        build (pkg, arch, callback);
      } else {
        callback ();
      }
    });
  }, (err) => callback (err, list));
}

function installBuildDeps (packagelist, arch, callback) {
  async.eachSeries (packagelist, (pkg, callback) => {
    install.package (pkg, false, callback);
  }, (err) => {
    xEnv.devrootUpdate ();
    callback (err);
  });
}

function getInstallDeps (packageName, arch, callback) {
  const packageDef = definition.load (packageName);
  let list = {};

  Object
    .keys (packageDef.dependency.install)
    .forEach ((dep) => {
      const depDef = definition.load (dep);

      if (depDef.architecture.indexOf ('source') === -1) {
        throw 'only source package are supported';
      }

      list[dep] = true;
      _.merge (list, getInstallDeps (dep));
    });

  callback (null, list);
}

function publishInstallDeps (packageList, arch, outputRepository, callback) {
  async.eachSeries (packageList, (pkg, callback) => {
    publish.package (pkg, outputRepository, callback);
  });
}

function buildSrc (packageName, arch, outputRepository, callback) {
  const name = packageName ? packageName + '-src' : null;
  wpkg.buildFromSrc (name, arch, pacmanConfig.pkgToolchainRepository, callback);
}

/*
 * 1.   begin the build with the start package
 * 2-3. buildSrcDeps ();
 * 4.   installBuildDeps ();
 * 5.   getInstallDeps (); // from the start package
 *      publishInstallDeps ();
 * 6.   buildSrc ();
 */
