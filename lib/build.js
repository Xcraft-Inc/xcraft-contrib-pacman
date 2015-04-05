'use strict';

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var busLog       = require ('xcraft-core-buslog');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


exports.package = function (packageRef, callback) {
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

    /* Build all packages in the source repository. */
    if (!packageName) {
      wpkg.buildFromSrc (null, arch, pacmanConfig.pkgRepository, callback);
      return;
    }

    var definition = require ('./definition.js');
    var packageDef = definition.load (packageName);

    /* Build only one source package. */
    wpkg.buildFromSrc (packageName + '-src', arch, packageDef.distribution, callback);
  });
};
