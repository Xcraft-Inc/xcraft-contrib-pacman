'use strict';

var utils = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


exports.package = function (packageRef, response, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  response.log.info ('Remove %s package%s on %s.',
                     pkg.name || 'all',
                     pkg.name ? '' : 's',
                     pkg.arch || 'all architectures');

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  wpkg.remove (pkg.name, pkg.arch, response, callback);
};
