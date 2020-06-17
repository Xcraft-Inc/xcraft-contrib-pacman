'use strict';

var path = require('path');
var util = require('util');

const genDepends = (deps) => {
  let cnt = 0;
  let result = '';

  Object.keys(deps).forEach((dep) => {
    deps[dep].forEach((it) => {
      result += `${cnt > 0 ? ', ' : ''}${dep}`;
      if (it.version && it.version.length > 0) {
        result += ` (${it.version})`;
      }
      if (it.architecture && it.architecture.length) {
        result += ` [${it.architecture.join(' ')}]`;
      }
      cnt++;
    });
  });

  return result;
};

/**
 * Convert a zog package definition to control definitions.
 *
 * @param {Object} packageDef - The package definitions.
 * @param {Object} resp - BusClient response handler.
 * @returns {Object[]} A control definition by architecture.
 */
var defToControl = function (packageDef, resp) {
  var controlMap = {
    name: 'Package',
    subpackage: 'Sub-Packages',
    version: 'Version',
    architecture: 'Architecture',
    maintainer: 'Maintainer',
    description: 'Description',
    distribution: 'Distribution',
    dependency: ['install', 'build', 'make'],
    install: 'Depends',
    build: 'X-Craft-Build-Depends',
    make: 'X-Craft-Make-Depends',
  };

  var controlList = {};

  packageDef.architecture.forEach(function (arch) {
    var control = '';
    var isInfo = packageDef.subpackage && !!packageDef.subpackage.length;

    Object.keys(packageDef).forEach(function (entry) {
      if (!controlMap[entry]) {
        return;
      }

      let keys = [];

      if (Array.isArray(controlMap[entry])) {
        keys = controlMap[entry];
      } else {
        keys = [entry];
      }

      keys.forEach((key) => {
        var subPackages = '';

        var fctValue = function (it) {
          var result = packageDef[it];

          switch (it) {
            case 'name': {
              if (isInfo) {
                /* HACK: should be handle for several subpackages. */
                subPackages = '/' + packageDef.subpackage[0].replace(/\*/, '');
              }
              break;
            }

            case 'architecture': {
              result = arch === 'source' ? '$(architecture())' : arch;
              break;
            }

            case 'distribution': {
              result = arch === 'source' ? '' : packageDef.distribution;
              break;
            }

            case 'maintainer': {
              result = util.format(
                '"%s" <%s>',
                packageDef[it].name,
                packageDef[it].email
              );
              break;
            }

            case 'description': {
              result = util.format('%s', packageDef[it].brief);
              if (packageDef[it].long.length > 0) {
                result += util.format(
                  '\n %s',
                  packageDef[it].long.replace(/\n/g, '\n ').trim()
                );
              }
              break;
            }

            case 'install':
            case 'build':
            case 'make': {
              if (packageDef.dependency[it]) {
                result = genDepends(packageDef.dependency[it]);
              }
              break;
            }
          }

          return result ? result.toString().trim() : '';
        };

        var result = fctValue(key);
        if (result.length > 0) {
          control += util.format(
            '%s%s: %s\n',
            controlMap[key],
            subPackages,
            result
          );
        }
      });
    });

    controlList[arch] = {
      data: control,
      info: isInfo,
    };

    resp.log.verb(util.format('Control file (%s):\n%s', arch, control));
  });

  return controlList;
};

/**
 * Generate and save all control files accordingly to the config yaml files.
 *
 * @param {string} packageArch - null for all architectures.
 * @param {Object} packageDef - The package definitions.
 * @param {boolean} saveFiles - Saves the control files.
 * @param {Object} resp - BusClient response handler.
 * @returns {Object[]} The list of all control file paths.
 */
exports.controlFiles = function (packageArch, packageDef, saveFiles, resp) {
  if (saveFiles) {
    resp.log.info(
      'if necessary, save the control files for ' + packageDef.name
    );
  }

  var xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  var pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );
  var xFs = require('xcraft-core-fs');
  var utils = require('../utils.js');

  var fs = require('fs');

  var control = defToControl(packageDef, resp);
  var controlFiles = [];

  Object.keys(control).forEach(function (arch) {
    if (!utils.checkOsSupport(packageDef.name, packageArch, packageDef, arch)) {
      return;
    }

    var wpkgName =
      arch === 'source'
        ? pacmanConfig.pkgWPKG.toLowerCase()
        : pacmanConfig.pkgWPKG.toUpperCase();
    var controlDir = path.join(
      xcraftConfig.pkgTempRoot,
      arch,
      packageDef.name,
      wpkgName
    );

    var suffix = control[arch].info ? '.info' : '';
    var controlFile = path.join(controlDir, 'control' + suffix);

    if (saveFiles) {
      if (fs.existsSync(controlFile)) {
        resp.log.warn('the control file will be overwritten: ' + controlFile);
      }

      /* A directory by architecture is created. */
      xFs.mkdir(controlDir);
      fs.writeFileSync(controlFile, control[arch].data);
    }

    controlFiles.push({
      arch: arch,
      control: controlFile,
    });
  });

  return controlFiles;
};
