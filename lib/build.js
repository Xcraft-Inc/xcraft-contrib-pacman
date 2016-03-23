'use strict';

var moduleName = 'pacman/build';

const path  = require ('path');
const async = require ('async');
const _     = require ('lodash');

var utils      = require ('./utils.js');
var admindir   = require ('./admindir.js');
var definition = require ('./def.js');
const install  = require ('./install.js');
const publish  = require ('./publish.js');

var xLog         = require ('xcraft-core-log') (moduleName);
var xEnv         = require ('xcraft-core-env');
const xFs        = require ('xcraft-core-fs');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var wpkg         = require ('xcraft-contrib-wpkg');


function buildSrcDeps (packageName, arch, buildFunc, callback) {
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
        buildFunc (pkg, arch, callback);
      } else {
        callback ();
      }
    });
  }, callback);
}

function getBuildDeps (packageName, arch, callback) {
  const packageDef = definition.load (packageName);
  const list = Object.keys (packageDef.dependency.build);
  callback (null, list);
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

  async.eachSeries (Object.keys (packageDef.dependency.install), (dep, callback) => {
    const depDef = definition.load (dep);

    if (depDef.architecture.indexOf ('source') === -1) {
      throw 'only source package are supported';
    }

    list[dep] = true;
    _.merge (list, getInstallDeps (dep, arch, callback));
  }, (err) => {
    if (err) {
      callback (err);
      return;
    }

    callback (null, Object.keys (list));
  });
}

function publishInstallDeps (packageList, arch, outputRepository, callback) {
  async.eachSeries (packageList, (pkg, callback) => {
    publish.package (pkg, outputRepository, callback);
  }, callback);
}

function buildSrc (packageName, arch, outputRepository, callback) {
  const name = packageName ? packageName + '-src' : null;
  wpkg.buildFromSrc (name, arch, outputRepository, callback);
}

function build (packageName, arch, callback) {
  async.auto ({
    buildSrcDeps: (callback) => {
      xLog.info (`build src dependencies of ${packageName}`);
      buildSrcDeps (packageName, arch, build, callback);
    },

    getBuildDeps: ['buildSrcDeps', (callback) => {
      xLog.info (`get build dependencies of ${packageName}`);
      getBuildDeps (packageName, arch, callback);
    }],

    installBuildDeps: ['getBuildDeps', (callback, res) => {
      xLog.info (`install new build dependencies`);
      installBuildDeps (res.getBuildDeps, arch, callback);
    }],

    getInstallDeps: ['installBuildDeps', (callback) => {
      xLog.info (`get install dependencies of ${packageName}`);
      getInstallDeps (packageName, arch, callback);
    }],

    publishInstallDeps: ['getInstallDeps', (callback, res) => {
      const outputRepository = path.join (xcraftConfig.tempRoot, 'wpkg-src-staging');
      xFs.rm (outputRepository);

      xLog.info (`publish install dependencies in ${outputRepository}`);

      const packageList = res.getInstallDeps.map ((pkg) => {
        return `${pkg}-src`;
      });
      packageList.push (`${packageName}-src`);

      publishInstallDeps (packageList, arch, outputRepository, (err) => {
        if (err) {
          callback (err);
          return;
        }

        callback (null, outputRepository);
      });
    }],

    buildSrc: ['publishInstallDeps', (callback, res) => {
      xLog.info (`build the src repository`);
      buildSrc (null, arch, res.publishInstallDeps, callback);
    }]
  }, (err, res) => {
    xFs.rm (res.publishInstallDeps);
    callback (err);
  });
}

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
