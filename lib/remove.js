'use strict';

var utils = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


class Remove {
  constructor (response) {
    this._response = response;
  }

  package (packageRef, callback) {
    var pkg = utils.parsePkgRef (packageRef);

    this._response.log.info ('Remove %s package%s on %s.',
                             pkg.name || 'all',
                             pkg.name ? '' : 's',
                             pkg.arch || 'all architectures');

    if (!utils.checkArch (pkg.arch)) {
      callback ('bad architecture');
      return;
    }

    wpkg.remove (pkg.name, pkg.arch, this._response, callback);
  }
}

module.exports = (response) => new Remove (response);
