'use strict';

const utils      = require ('./utils.js');
const definition = require ('./def.js');

const wpkg = require ('xcraft-contrib-wpkg');


exports.add = function (packageRef, inputRepository, outputRepository, response, callback) {
  const pkg = utils.parsePkgRef (packageRef);

  response.log.info (`Publish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
                     `on ${pkg.arch || 'all architectures'}.`);

  let def;
  try {
    def = definition.load (pkg.name, null, response);
  } catch (ex) {
    callback (ex);
    return;
  }

  const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
  wpkg.publish (pkg.name, pkg.arch, inputRepository, outputRepository, distrib, response, callback);
};

exports.remove = function (packageRef, repository, response, callback) {
  const pkg = utils.parsePkgRef (packageRef);

  response.log.info (`Unpublish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
                     `on ${pkg.arch || 'all architectures'}.`);

  let def;
  try {
    def = definition.load (pkg.name, null, response);
  } catch (ex) {
    callback (ex);
    return;
  }

  const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
  wpkg.unpublish (pkg.name, pkg.arch, repository, distrib, response, callback);
};

exports.status = function (packageRef, repositoryPath, response, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  wpkg.isPublished (pkg.name, null, pkg.arch, repositoryPath, response, function (err, deb) {
    response.log.info (`The package ${pkg.name} is ${!deb ? 'not ' : ''}published.`);
    callback (err, deb);
  });
};
