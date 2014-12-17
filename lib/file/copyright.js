'use strict';

var moduleName = 'manager';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);


/**
 * Convert a zog package definition to a copyright file.
 *
 * @param {Object} packageDef
 * @returns {Object[]} A Copyright file.
 */
var defToCopyright = function (packageDef) {
  var copyrightList = {};

  packageDef.architecture.forEach (function (arch) {
    var copyright = 'Format: http://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n';

    copyright += util.format ('Upstream-Name: %s\n', packageDef.name);
    copyright += util.format ('Upstream-Contact: "%s" <%s>\n',
                              packageDef.maintainer.name,
                              packageDef.maintainer.email);

    copyrightList[arch] = copyright;

    xLog.verb (util.format ('Copyright file:\n%s', copyright));
  });

  return copyrightList;
};

/**
 * Generate and save all copyright files accordingly to the config.yaml files.
 *
 * @param {string} packageName
 * @param {string} packageArch
 * @param {boolean} saveFiles - Saves the copyright files.
 * @returns {Object[]} The list of all copyright file paths.
 */
exports.copyrightFiles = function (packageName, packageArch, saveFiles) {
  if (saveFiles) {
    xLog.info ('if necessary, save the copyright file for ' + packageName);
  }

  var fs = require ('fs');
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var xFs           = require ('xcraft-core-fs');
  var utils         = require ('../utils.js');
  var definition    = require ('../definition.js');

  var def       = definition.load (packageName);
  var copyright = defToCopyright (def);

  var copyrightFiles = [];

  Object.keys (copyright).forEach (function (arch) {
    if (!utils.checkOsSupport (packageName, packageArch, arch)) {
      return;
    }

    var wpkgName = arch === 'source' ?
                   pacmanConfig.pkgWPKG.toLowerCase () :
                   pacmanConfig.pkgWPKG.toUpperCase ();
    var wpkgDir = path.join (xcraftConfig.pkgTempRoot,
                             arch, packageName, wpkgName);
    var copyrightFile = path.join (wpkgDir, 'copyright');

    if (saveFiles) {
      if (fs.existsSync (copyrightFile)) {
        xLog.warn ('the copyright file will be overwritten: ' + copyrightFile);
      }

      xFs.mkdir (wpkgDir);
      fs.writeFileSync (copyrightFile, copyright[arch]);
    }

    copyrightFiles.push ({
      arch   : arch,
      control: copyrightFile
    });
  });

  return copyrightFiles;
};
