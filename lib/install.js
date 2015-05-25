'use strict';

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var busLog = require ('xcraft-core-buslog');


exports.package = function (packageRef, reinstall, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  busLog.info ('Install %s package%s on %s.',
               pkg.name || 'all',
               pkg.name ? '' : 's',
               pkg.arch || 'all architectures');

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    wpkg.install (packageName, arch, reinstall, callback);
  });
};

exports.status = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  wpkg.isInstalled (pkg.name, pkg.arch, function (err, isInstalled) {
    busLog.info ('The package %s is %sinstalled in %s.',
                 pkg.name, !isInstalled ? 'not ' : '', pkg.arch);
    callback (err, isInstalled);
  });
};