'use strict';

var moduleName = 'pacman/install';

var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var xLog = require ('xcraft-core-log') (moduleName);
var wpkg = require ('xcraft-contrib-wpkg');


exports.package = function (packageRef, reinstall, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.info ('Install %s package%s on %s.',
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
    xLog.info ('The package %s is %sinstalled in %s.',
               pkg.name, !isInstalled ? 'not ' : '', pkg.arch);
    callback (err, isInstalled);
  });
};
