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

  /**
   * Check if this new version is not already built, bump the package
   * version if necessary.
   *
   *  1. Check for the source package; no bump if not present
   *  2. If src present, then check for the bin package; bump if present
   *
   * It's fine to have the source package while the binary package is still
   * not built.
   *
   * @yields
   * @param {*} packageRef - The package.
   * @param {*} version - Desired version.
   * @param {*} [distribution] - Distribution.
   * @returns {string} the new version.
   */
  *getNewVersionIfArchived(packageRef, version, distribution) {
    const definition = require('./def.js');

    const pkg = utils.parsePkgRef(packageRef);

    const packageDef = definition.load(pkg.name, {}, this._resp, distribution);
    const isSrc = packageDef.architecture.some((arch) => arch === 'source');
    const _distribution =
      isSrc && distribution?.indexOf('+') === -1
        ? 'sources'
        : distribution || packageDef.distribution;
    const suffix = isSrc ? '-src' : '';

    let isPublished;
    do {
      try {
        const def = yield this._wpkg.show(
          pkg.name + suffix,
          null,
          version,
          _distribution
        );
        isPublished = !!def;
        if (!isPublished) {
          break;
        }

        if (isSrc) {
          /* Bump only if this src package is already built */
          const def = yield this._wpkg.show(
            pkg.name,
            null,
            version,
            distribution || packageDef.distribution
          );
          isPublished = !!def;
        }

        if (isPublished) {
          version = definition.bumpPackageVersion(version);
        }
      } catch (ex) {
        if (ex !== 'package not found') {
          throw ex;
        }
        isPublished = false;
      }
    } while (isPublished);

    return version;
  }
}

module.exports = (resp) => new Publish(resp);
