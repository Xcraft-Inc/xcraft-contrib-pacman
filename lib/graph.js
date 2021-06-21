'use strict';

const watt = require('gigawatts');

const utils = require('./utils.js');

class Graph {
  constructor(resp) {
    this._resp = resp;

    this._wpkg = require('xcraft-contrib-wpkg')(resp);

    watt.wrapAll(this);
  }

  *graph(packageNames, distribution, next) {
    const pkg = utils.parsePkgRef(packageNames[0]);

    this._resp.log.info(
      `Generate dependency graph for ${pkg.name || 'all'}... on ${
        pkg.arch || 'all architectures'
      } for ${distribution}`
    );

    if (!utils.checkArch(pkg.arch)) {
      throw 'bad architecture';
    }

    yield this._wpkg.graph(packageNames, pkg.arch, distribution, next);
  }
}

module.exports = (resp) => new Graph(resp);
