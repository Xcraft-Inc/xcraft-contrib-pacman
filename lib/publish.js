'use strict';

const moduleName = 'pacman/publish';

const utils      = require ('./utils.js');
const definition = require ('./def.js');

const xLog = require ('xcraft-core-log') (moduleName);
const wpkg = require ('xcraft-contrib-wpkg');


exports.add = function (packageRef, inputRepository, outputRepository, callback) {
  const pkg = utils.parsePkgRef (packageRef);

  xLog.info (`Publish ${pkg.name || 'all'} package${pkg.name && 's'} ` +
             `on ${pkg.arch || 'all architectures'}.`);

  let def;
  try {
    def = definition.load (pkg.name);
  } catch (ex) {
    callback (ex);
    return;
  }

  const distrib = /.*-src$/.test (pkg.name) ? 'sources' : def.distribution;
  wpkg.publish (pkg.name, pkg.arch, inputRepository, outputRepository, distrib, callback);
};

exports.status = function (packageRef, repositoryPath, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  wpkg.isPublished (pkg.name, null, pkg.arch, repositoryPath, function (err, deb) {
    xLog.info (`The package ${pkg.name} is ${!deb ? 'not ' : ''}published.`);
    callback (err, deb);
  });
};
