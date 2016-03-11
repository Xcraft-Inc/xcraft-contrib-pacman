'use strict';

var moduleName = 'pacman/remove';

var utils = require ('./utils.js');

var xLog = require ('xcraft-core-log') (moduleName);
var wpkg = require ('xcraft-contrib-wpkg');


exports.package = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.info ('Remove %s package%s on %s.',
             pkg.name || 'all',
             pkg.name ? '' : 's',
             pkg.arch || 'all architectures');

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  wpkg.remove (pkg.name, pkg.arch, callback);
};
