'use strict';

const utils      = require ('./utils.js');
const definition = require ('./def.js');

const wpkg = require ('xcraft-contrib-wpkg');


class Publish {
  constructor (response) {
    this._response = response;
  }

  add (packageRef, inputRepository, outputRepository, callback) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info (`Publish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
                             `on ${pkg.arch || 'all architectures'}.`);

    let def;
    try {
      def = definition.load (pkg.name, null, this._response);
    } catch (ex) {
      callback (ex);
      return;
    }

    const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
    wpkg.publish (pkg.name, pkg.arch, inputRepository, outputRepository, distrib, this._response, callback);
  }

  remove (packageRef, repository, callback) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.info (`Unpublish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
                             `on ${pkg.arch || 'all architectures'}.`);

    let def;
    try {
      def = definition.load (pkg.name, null, this._response);
    } catch (ex) {
      callback (ex);
      return;
    }

    const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
    wpkg.unpublish (pkg.name, pkg.arch, repository, distrib, this._response, callback);
  }

  status (packageRef, repositoryPath, callback) {
    var pkg = utils.parsePkgRef (packageRef);

    wpkg.isPublished (pkg.name, null, pkg.arch, repositoryPath, this._response, (err, deb) => {
      this._response.log.info (`The package ${pkg.name} is ${!deb ? 'not ' : ''}published.`);
      callback (err, deb);
    });
  }
}

module.exports = (response) => new Publish (response);
