'use strict';

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');

var busLog = require ('xcraft-core-buslog');


exports.package = function (packageRef, callback) {
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
