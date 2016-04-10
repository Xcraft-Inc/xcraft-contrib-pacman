'use strict';

const watt = require ('watt');

const utils = require ('./utils.js');

const wpkg = require ('xcraft-contrib-wpkg');


class Remove {
  constructor (response) {
    this._response = response;

    watt.wrapAll (this);
  }

  * package (packageRef, next) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info ('Remove %s package%s on %s.',
                             pkg.name || 'all',
                             pkg.name ? '' : 's',
                             pkg.arch || 'all architectures');

    if (!utils.checkArch (pkg.arch)) {
      throw 'bad architecture';
    }

    yield wpkg.remove (pkg.name, pkg.arch, this._response, next);
  }
}

module.exports = (response) => new Remove (response);
