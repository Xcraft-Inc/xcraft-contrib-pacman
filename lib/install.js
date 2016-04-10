'use strict';

const utils = require ('./utils.js');
const watt  = require ('watt');

const wpkg = require ('xcraft-contrib-wpkg');


class Install {
  constructor (response) {
    this._response = response;

    this._admindir = require ('./admindir.js') (response);

    watt.wrapAll (this);
  }

  * package (packageRef, reinstall, next) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info ('Install %s package%s on %s.',
                             pkg.name || 'all',
                             pkg.name ? '' : 's',
                             pkg.arch || 'all architectures');

    const res = yield this._admindir.create (packageRef);
    yield wpkg.install (res.name, res.arch, reinstall, this._response, next);
  }

  * status (packageRef, next) {
    const pkg = utils.parsePkgRef (packageRef);

    const isInstalled = yield wpkg.isInstalled (pkg.name, pkg.arch, this._response, next);
    this._response.log.info ('The package %s is %sinstalled in %s.',
                             pkg.name, !isInstalled ? 'not ' : '', pkg.arch);
    return isInstalled;
  }
}

module.exports = (response) => new Install (response);
