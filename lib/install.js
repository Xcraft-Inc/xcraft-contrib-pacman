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

    let results;
    const fields = yield this._wpkg.fields(
      pkg.name,
      pkg.arch,
      distribution,
      next
    );

    if (fields) {
      results = {
        version: fields.version,
        installed: fields.status === 'Installed',
      };
    } else {
      results = {
        version: null,
        installed: false,
      };
    }

    this._resp.log.info(
      'The package %s is %sinstalled in %s.',
      pkg.name,
      !results.installed ? 'not ' : '',
      pkg.arch
    );

    return results;
  }
}

module.exports = resp => new Install(resp);
