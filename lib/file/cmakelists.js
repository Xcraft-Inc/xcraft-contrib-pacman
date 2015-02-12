'use strict';

var moduleName = 'manager';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);


/**
 * Convert a zog package definition to a CMakeLists.txt file.
 *
 * @param {Object} packageDef
 * @returns {string} A CMakeLists.txt file.
 */
var defToCMakeLists = function (packageDef) {
  var xPlatform = require ('xcraft-core-platform');

  if (packageDef.architecture.some (function (arch) {
    return arch === 'source';
  })) {
    var cmakelists = '';
    cmakelists  = 'cmake_minimum_required (VERSION 3.0)\n';
    cmakelists += 'set(CPACK_SOURCE_GENERATOR "TGZ")\n';
    cmakelists += util.format ('set(CPACK_SOURCE_PACKAGE_FILE_NAME "%s_%s")\n',
                               packageDef.name, packageDef.version);
    cmakelists += 'include(CPack)\n';

    cmakelists += 'add_custom_target(peonMake ALL' +
                  ' ./makeall' + xPlatform.getShellExt () +
                  ' ${CMAKE_BINARY_DIR}' +
                  ' WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})';

    xLog.verb (util.format ('CMakeLists file:\n%s', cmakelists));
    return cmakelists;
  }

  return null;
};

/**
 * Generate and save the CMakeLists.txt file accordingly to the config.yaml file.
 *
 * @param {string} packageName
 * @param {string} packageArch
 * @param {boolean} saveFile - Saves the CMakeLists.txt file.
 * @returns {string} The CMakeLists file path.
 */
exports.cmakelistsFile = function (packageName, packageArch, saveFile) {
  var utils = require ('../utils.js');

  if (saveFile) {
    xLog.info ('if necessary, save the cmakelists file for ' + packageName);
  }

  if (!utils.checkOsSupport (packageName, packageArch, 'source')) {
    return null;
  }

  var fs = require ('fs');
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var xFs           = require ('xcraft-core-fs');
  var definition    = require ('../definition.js');

  var def        = definition.load (packageName);
  var cmakelists = defToCMakeLists (def);

  if (!cmakelists) {
    return null;
  }

  var packageDir = path.join (xcraftConfig.pkgTempRoot, 'source', packageName);
  var cmakelistsFile = path.join (packageDir, 'CMakeLists.txt');

  if (saveFile) {
    if (fs.existsSync (cmakelistsFile)) {
      xLog.warn ('the CMakeLists file will be overwritten: ' + cmakelistsFile);
    }

    xFs.mkdir (packageDir);
    fs.writeFileSync (cmakelistsFile, cmakelists);
  }

  return cmakelistsFile;
};
