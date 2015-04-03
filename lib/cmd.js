'use strict';

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var busClient = require ('xcraft-core-busclient');
var busLog    = require ('xcraft-core-buslog');


exports.install = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  busClient.events.send ('widget.text.info',
                         'Install ' + (pkg.name || 'all') +
                         ' package' + (pkg.name ? '' : 's') +
                         ' on ' + (pkg.arch || 'all architectures') + '.');

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    wpkg.install (packageName, arch, callback);
  });
};

exports.remove = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  busLog.info ('Remove %s package%s on %s.',
               pkg.name || 'all',
               pkg.name ? '' : 's',
               pkg.arch || 'all architectures');

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  wpkg.remove (pkg.name, pkg.arch, callback);
};
