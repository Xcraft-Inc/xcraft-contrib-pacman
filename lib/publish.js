'use strict';

const watt = require('gigawatts');

const utils = require('./utils.js');

class Publish {
  constructor(resp) {
    this._resp = resp;

    this._wpkg = require('xcraft-contrib-wpkg')(resp);

    watt.wrapAll(this);
  }

  *add(packageRef, inputRepository, outputRepository, distribution, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._resp.log.info(
      `Publish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
        `on ${pkg.arch || 'all architectures'}.`
    );

    const distrib = /.*-src$/.test(pkg.name) ? 'sources/' : distribution;
    yield this._wpkg.publish(
      pkg.name,
      pkg.arch,
      inputRepository,
      outputRepository,
      distrib,
      next
    );
  }

  *remove(packageRef, repository, distribution, updateIndex, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._resp.log.info(
      `Unpublish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
        `on ${pkg.arch || 'all architectures'}.`
    );

    const distrib = /.*-src$/.test(pkg.name) ? 'sources/' : distribution;
    yield this._wpkg.unpublish(
      pkg.name,
      pkg.arch,
      repository,
      distrib,
      updateIndex,
      next
    );
  }

  *removeAll(packageList, repository, distribution, next) {
    let cnt = packageList.length;
    for (const pkg of packageList) {
      --cnt;
      yield this.remove(pkg, repository, distribution, cnt === 0, next);
    }
  }

  *status(packageRef, distribution, repositoryPath, next) {
    var pkg = utils.parsePkgRef(packageRef);

    const deb = yield this._wpkg.isPublished(
      pkg.name,
      null,
      pkg.arch,
      distribution,
      repositoryPath,
      next
    );
    this._resp.log.info(
      `The package ${pkg.name} is ${!deb ? 'not ' : ''}published.`
    );
    return deb;
  }
}

module.exports = (resp) => new Publish(resp);
