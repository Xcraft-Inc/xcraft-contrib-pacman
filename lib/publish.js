'use strict';

const moduleName = 'pacman/publish';

const utils = require ('./utils.js');

const xLog = require ('xcraft-core-log') (moduleName);
const wpkg = require ('xcraft-contrib-wpkg');


exports.package = function (packageRef, outputRepository, callback) {
  const pkg = utils.parsePkgRef (packageRef);

  xLog.info ('Publish %s package%s on %s.',
             pkg.name || 'all',
             pkg.name ? '' : 's',
             pkg.arch || 'all architectures');

  wpkg.publish (pkg.name, pkg.arch, outputRepository, callback);
};
