'use strict';

const utils = require('./utils.js');
const watt = require('gigawatts');

class Install {
  constructor(response) {
    this._response = response;

    this._admindir = require('./admindir.js')(response);
    this._wpkg = require('xcraft-contrib-wpkg')(response);

    watt.wrapAll(this);
  }

  *package(packageRef, distribution, prodRoot, reinstall, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._response.log.info(
      'Install %s package%s on %s.',
      pkg.name || 'all',
      pkg.name ? '' : 's',
      pkg.arch || 'all architectures'
    );

    const res = yield this._admindir.create(packageRef, prodRoot, distribution);
    yield this._wpkg.install(
      res.name,
      res.arch,
      distribution,
      prodRoot,
      reinstall,
      next
    );
  }

  *status(packageRef, distribution, next) {
    const pkg = utils.parsePkgRef(packageRef);

    const isInstalled = yield this._wpkg.isInstalled(
      pkg.name,
      pkg.arch,
      distribution,
      next
    );
    this._response.log.info(
      'The package %s is %sinstalled in %s.',
      pkg.name,
      !isInstalled ? 'not ' : '',
      pkg.arch
    );
    return isInstalled;
  }
}

module.exports = response => new Install(response);
