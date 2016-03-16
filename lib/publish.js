'use strict';

const moduleName = 'pacman/publish';

const utils      = require ('./utils.js');
const definition = require ('./def.js');

const xLog = require ('xcraft-core-log') (moduleName);
const wpkg = require ('xcraft-contrib-wpkg');


exports.package = function (packageRef, outputRepository, callback) {
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
  wpkg.publish (pkg.name, pkg.arch, outputRepository, distrib, callback);
};
