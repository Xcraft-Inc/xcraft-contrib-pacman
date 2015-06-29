'use strict';

var moduleName = 'pacman/etc';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);

require ('xcraft-core-buslog') (xLog);


/**
 * Generate and save all config files accordingly to the config.yaml files.
 *
 * @param {string} packageArch
 * @param {Object} packageDef - The package definitions.
 */
exports.etcFiles = function (packageArch, packageDef) {
  var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
  var xFs          = require ('xcraft-core-fs');

  var fs    = require ('fs');
  var utils = require ('../utils.js');

  packageDef.architecture.forEach (function (arch) {
    if (!utils.checkOsSupport (packageDef.name, packageArch, packageDef, arch)) {
      return;
    }

    if (!packageDef.data.path || !packageDef.data.path.length) {
      return;
    }

    var data = JSON.stringify (packageDef.data.path, null, '  ');
    xLog.verb (util.format ('Config file for PATH:\n%s', data));

    var etcDir = path.join (xcraftConfig.pkgTempRoot,
                            arch, packageDef.name, 'etc/path');
    var fileOut = path.join (etcDir, packageDef.name + '.json');

    if (fs.existsSync (fileOut)) {
      xLog.warn ('the copyright file will be overwritten: ' + fileOut);
    }

    xFs.mkdir (etcDir);
    fs.writeFileSync (fileOut, utils.injectThisPh (packageDef, data));
  });
};
