'use strict';

var path = require ('path');

/**
 * Generate and save all copyright files accordingly to the config yaml files.
 *
 * @param {string} packageArch
 * @param {Object} packageDef - The package definitions.
 */
exports.copyrightFiles = function (packageArch, packageDef, response) {
  var xcraftConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft'
  );
  var pacmanConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft-contrib-pacman'
  );
  var xFs = require ('xcraft-core-fs');
  var xPh = require ('xcraft-core-placeholder');

  var fs = require ('fs');
  var utils = require ('../utils.js');

  packageDef.architecture.forEach (function (arch) {
    if (
      !utils.checkOsSupport (packageDef.name, packageArch, packageDef, arch)
    ) {
      return;
    }

    var wpkgName = arch === 'source'
      ? pacmanConfig.pkgWPKG.toLowerCase ()
      : pacmanConfig.pkgWPKG.toUpperCase ();
    var wpkgDir = path.join (
      xcraftConfig.pkgTempRoot,
      arch,
      packageDef.name,
      wpkgName
    );

    var fileIn = path.join (__dirname, '../templates/copyright');
    var fileOut = path.join (wpkgDir, 'copyright');

    if (fs.existsSync (fileOut)) {
      response.log.warn ('the copyright file will be overwritten: ' + fileOut);
    }

    xFs.mkdir (wpkgDir);

    var ph = new xPh.Placeholder ();
    ph
      .set ('NAME', packageDef.name)
      .set ('MAINTAINER.NAME', packageDef.maintainer.name)
      .set ('MAINTAINER.EMAIL', packageDef.maintainer.email)
      .injectFile ('PACKAGE', fileIn, fileOut);
  });
};
