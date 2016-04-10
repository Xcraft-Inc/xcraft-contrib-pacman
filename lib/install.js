'use strict';

var utils    = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


exports.package = function (packageRef, reinstall, response, callback) {
  var admindir = require ('./admindir.js') (response);
  var pkg = utils.parsePkgRef (packageRef);

  response.log.info ('Install %s package%s on %s.',
             pkg.name || 'all',
             pkg.name ? '' : 's',
             pkg.arch || 'all architectures');

  admindir.create (packageRef, function (err, res) {
    if (err) {
      callback (err);
      return;
    }

    wpkg.install (res.name, res.arch, reinstall, response, callback);
  });
};

exports.status = function (packageRef, response, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  wpkg.isInstalled (pkg.name, pkg.arch, response, function (err, isInstalled) {
    response.log.info ('The package %s is %sinstalled in %s.',
               pkg.name, !isInstalled ? 'not ' : '', pkg.arch);
    callback (err, isInstalled);
  });
};
