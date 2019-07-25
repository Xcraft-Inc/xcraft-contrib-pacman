'use strict';

const watt = require('gigawatts');

const utils = require('./utils.js');

class Remove {
  constructor(response) {
    this._response = response;

    this._wpkg = require('xcraft-contrib-wpkg')(response);

    watt.wrapAll(this);
  }

  *package(packageRef, recursive, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._response.log.info(
      'Remove %s package%s on %s.',
      pkg.name || 'all',
      pkg.name ? '' : 's',
      pkg.arch || 'all architectures'
    );

    if (!utils.checkArch(pkg.arch)) {
      throw 'bad architecture';
    }

    yield this._wpkg.remove(pkg.name, pkg.arch, recursive, next);
  }
}

module.exports = response => new Remove(response);
