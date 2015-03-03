'use strict';

var moduleName = 'manager';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);


/**
 * Convert a zog package definition to a config file for PATH.
 *
 * @param {Object} packageDef
 * @returns {Object[]} A config file for PATH.
 */
var defToEtcPath = function (packageDef) {
  var etcPathList = {};

  packageDef.architecture.forEach (function (arch) {
    if (!packageDef.data.path || !packageDef.data.path.length) {
      return;
    }

    var etcPath = JSON.stringify (packageDef.data.path, null, '  ');
    etcPathList[arch] = etcPath;

    xLog.verb (util.format ('Config file for PATH:\n%s', etcPath));
  });

  return etcPathList;
};

/**
 * Generate and save all config files accordingly to the config.yaml files.
 *
 * @param {string} packageName
 * @param {string} packageArch
 * @param {boolean} saveFiles - Saves the config files.
 * @returns {Object[]} The list of all config file paths.
 */
exports.etcFiles = function (packageName, packageArch, saveFiles) {
  if (saveFiles) {
    xLog.info ('if necessary, save the config file for ' + packageName);
  }

  var fs = require ('fs');
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var xFs           = require ('xcraft-core-fs');
  var utils         = require ('../utils.js');
  var definition    = require ('../definition.js');

  var def     = definition.load (packageName);
  var etcPath = defToEtcPath (def);

  var etcFiles = [];

  Object.keys (etcPath).forEach (function (arch) {
    if (!utils.checkOsSupport (packageName, packageArch, arch)) {
      return;
    }

    var etcDir = path.join (xcraftConfig.pkgTempRoot,
                            arch, packageName, 'etc/path');
    var etcPathFile = path.join (etcDir, packageName + '.json');

    if (saveFiles) {
      if (fs.existsSync (etcPathFile)) {
        xLog.warn ('the copyright file will be overwritten: ' + etcPathFile);
      }

      xFs.mkdir (etcDir);
      fs.writeFileSync (etcPathFile, etcPath[arch]);
    }

    etcFiles.push ({
      arch:    arch,
      control: etcPathFile
    });
  });

  return etcFiles;
};
