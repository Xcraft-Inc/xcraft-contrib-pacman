'use strict';

var path = require('path');
var util = require('util');

const genDepends = (deps, subPackage = null) => {
  let cnt = 0;
  let result = '';

  Object.keys(deps).forEach((dep) => {
    deps[dep]
      .filter((it) => {
        if (subPackage) {
          return it.subpackage
            ? it.subpackage.indexOf(subPackage) !== -1
            : false;
        }
        return it.subpackage ? false : true;
      })
      .forEach((it) => {
        const name = it.external ? `*${it.external}@${dep}` : dep;
        result += `${cnt > 0 ? ', ' : ''}${name}`;
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
 * @param {object} packageDef - The package definitions.
 * @param {object} resp - BusClient response handler.
 * @returns {object[]} A control definition by architecture.
 */
var defToControl = function (packageDef, resp) {
  var controlMap = {
    name: 'Package',
    subpackage: ['isubpackage', 'xsubpackage'],
    isubpackage: 'Sub-Packages',
    xsubpackage: 'X-Craft-Sub-Packages',
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

      let subPackages = [];
      let mainPackage = 0;

      keys.forEach((key) => {
        var fctValue = function (it) {
          var result = packageDef[it];

          switch (it) {
            case 'isubpackage': {
              result = packageDef.subpackage
                .map((sub) => sub.replace(/:.*/, ''))
                .join(', ');
              break;
            }

            case 'xsubpackage': {
              result = packageDef.subpackage
                .map((sub) => sub.replace(/:.*/, '').replace(/[*]$/, ''))
                .filter((sub) => sub !== 'runtime')
                .join(', ');
              break;
            }

            case 'name': {
              if (isInfo) {
                subPackages = packageDef.subpackage.map((subPackage, index) => {
                  if (subPackage.indexOf('*') !== -1) {
                    mainPackage = index;
                  }
                  return subPackage.replace(/\*/, '');
                });
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
        switch (key) {
          case 'name': {
            if (result) {
              if (subPackages.length > 0) {
                subPackages
                  .map((subPackage) => subPackage.replace(/:.*/, ''))
                  .forEach((subPackage, index) => {
                    control += `${controlMap[key]}/${subPackage}: ${result}`;
                    control +=
                      index !== mainPackage ? `-${subPackage}\n` : '\n';
                  });
              } else {
                control += `${controlMap[key]}: ${result}\n`;
              }
            }
            break;
          }

          case 'architecture': {
            if (result) {
              control += `${controlMap[key]}: ${result}\n`;
              if (packageDef.subpackage.length > 0) {
                packageDef.subpackage
                  .filter((subPackage) => subPackage.indexOf(':') !== -1)
                  .forEach((_subPackage) => {
                    let [subPackage, arch] = _subPackage.split(':');
                    subPackage = subPackage.replace(/\*/, '');
                    control += `${controlMap[key]}/${subPackage}: ${arch}\n`;
                  });
              }
            }
            break;
          }

          case 'install': {
            let useGlobal = false;
            const _done = {};

            for (const dep in packageDef.dependency[key]) {
              for (const _dep of packageDef.dependency[key][dep]) {
                if (_dep.subpackage && _dep.subpackage.length > 0) {
                  for (const subPackage of _dep.subpackage) {
                    if (_done[subPackage]) {
                      continue;
                    }
                    _done[subPackage] = true;
                    const _result = genDepends(
                      packageDef.dependency[key],
                      subPackage
                    );
                    control += `${controlMap[key]}/${subPackage}: ${_result}\n`;
                  }
                } else if (result) {
                  useGlobal = true;
                }
              }
            }

            if (useGlobal) {
              if (isInfo) {
                control += 'Build-';
              }
              control += `${controlMap[key]}: ${result}\n`;
            }
            break;
          }

          default: {
            if (result) {
              control += `${controlMap[key]}: ${result}\n`;
            }
            break;
          }
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
