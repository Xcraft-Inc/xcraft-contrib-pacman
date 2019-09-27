'use strict';

const watt = require('gigawatts');

const utils = require('./utils.js');

class Remove {
  constructor(response) {
    this._response = response;

    this._wpkg = require('xcraft-contrib-wpkg')(response);

    watt.wrapAll(this);
  }

  *package(packageRef, distribution, recursive, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._response.log.info(
      `Remove ${pkg.name || 'all'} package${
        pkg.name ? '' : 's'
      } on ${pkg.arch || 'all architectures'} for ${distribution}`
    );

    if (!utils.checkArch(pkg.arch)) {
      throw 'bad architecture';
    }

    yield this._wpkg.remove(pkg.name, pkg.arch, distribution, recursive, next);
  }
}

module.exports = response => new Remove(response);
