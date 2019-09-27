'use strict';

const utils = require('./utils.js');
const watt = require('gigawatts');

class Install {
  constructor(resp) {
    this._resp = resp;

    this._admindir = require('./admindir.js')(resp);
    this._wpkg = require('xcraft-contrib-wpkg')(resp);

    watt.wrapAll(this);
  }

  *package(packageRef, distribution, prodRoot, reinstall, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._resp.log.info(
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
    this._resp.log.info(
      'The package %s is %sinstalled in %s.',
      pkg.name,
      !isInstalled ? 'not ' : '',
      pkg.arch
    );
    return isInstalled;
  }
}

module.exports = resp => new Install(resp);
