'use strict';

var moduleName = 'pacman/cmakelists';

var path = require ('path');

var xLog = require ('xcraft-core-log') (moduleName);


/**
 * Generate and save the CMakeLists file accordingly to the config yaml file.
 *
 * @param {string} packageArch
 * @param {Object} packageDef - The package definitions.
 */
exports.cmakelistsFile = function (packageArch, packageDef) {
  var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var xFs          = require ('xcraft-core-fs');
  var xPlatform    = require ('xcraft-core-platform');
  var xPh          = require ('xcraft-core-placeholder');

  var utils = require ('../utils.js');
  var fs    = require ('fs');

  if (!utils.checkOsSupport (packageDef.name, packageArch, packageDef, 'source')) {
    return;
  }

  if (packageDef.architecture.some (function (arch) {
    return arch === 'source';
  })) {
    var packageDir = path.join (xcraftConfig.pkgTempRoot, 'source', packageDef.name);

    var fileIn  = path.join (__dirname, '../templates/CMakeLists.txt');
    var fileOut = path.join (packageDir, 'CMakeLists.txt');

    if (fs.existsSync (fileOut)) {
      xLog.warn ('the CMakeLists.txt file will be overwritten: ' + fileOut);
    }

    xFs.mkdir (packageDir);

    var ph = new xPh.Placeholder ();
    ph.set ('NAME',    packageDef.name)
      .set ('VERSION', packageDef.version)
      .set ('MAKEALL', pacmanConfig.pkgMakeall + xPlatform.getShellExt ())
      .injectFile ('PACKAGE', fileIn, fileOut);
  }
};
