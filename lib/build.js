'use strict';

var moduleName = 'pacman-build';

var async = require ('async');

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var busLog       = require ('xcraft-core-buslog');
var xLog         = require ('xcraft-core-log') (moduleName);
var xPath        = require ('xcraft-core-path');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


exports.package = function (packageRef, callback) {
  var _ = require ('lodash');

  var pkg = utils.parsePkgRef (packageRef);

  busLog.info ('Build %s package%s on %s.',
               pkg.name || 'all',
               pkg.name ? '' : 's',
               pkg.arch || 'all architectures');

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    var definition = require ('./definition.js');

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
          var packageDef = definition.load (name);

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
          xPath.devrootUpdate ();
          callback (err);
        });
      }],

      /* Build one or all packages of the source repository. */
      buildFromSrc: ['installDeps', function (callback) {
        var name = packageName ? packageName + '-src' : null;
        wpkg.buildFromSrc (name, arch, pacmanConfig.pkgToolchainRepository, callback);
      }]
    }, callback);
  });
};
