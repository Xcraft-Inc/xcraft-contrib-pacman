'use strict';

const watt = require ('watt');

const utils      = require ('./utils.js');
const definition = require ('./def.js');

const wpkg = require ('xcraft-contrib-wpkg');


class Publish {
  constructor (response) {
    this._response = response;

    watt.wrapAll (this);
  }

  * add (packageRef, inputRepository, outputRepository, next) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info (`Publish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
                             `on ${pkg.arch || 'all architectures'}.`);

    const def = definition.load (pkg.name, null, this._response);

    const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
    yield wpkg.publish (pkg.name, pkg.arch, inputRepository, outputRepository, distrib, this._response, next);
  }

  * remove (packageRef, repository, next) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info (`Unpublish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
                             `on ${pkg.arch || 'all architectures'}.`);

    const def = definition.load (pkg.name, null, this._response);
    const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
    yield wpkg.unpublish (pkg.name, pkg.arch, repository, distrib, this._response, next);
  }

  * status (packageRef, repositoryPath, next) {
    var pkg = utils.parsePkgRef (packageRef);

    const deb = yield wpkg.isPublished (pkg.name, null, pkg.arch, repositoryPath, this._response, next);
    this._response.log.info (`The package ${pkg.name} is ${!deb ? 'not ' : ''}published.`);
    return deb;
  }
}

module.exports = (response) => new Publish (response);
