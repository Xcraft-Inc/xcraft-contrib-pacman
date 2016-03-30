'use strict';

var moduleName = 'pacman/control';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);


/**
 * Convert a zog package definition to control definitions.
 *
 * @param {Object} packageDef
 * @returns {Object[]} A control definition by architecture.
 */
var defToControl = function (packageDef) {
  var controlMap = {
    name:            'Package',
    subpackage:      'Sub-Packages',
    version:         'Version',
    architecture:    'Architecture',
    maintainer:      'Maintainer',
    description:     'Description',
    dependency:      'Depends',
    distribution:    'Distribution'
  };

  var controlList = {};

  packageDef.architecture.forEach (function (arch) {
    var control = '';
    var isInfo = packageDef.hasOwnProperty ('subpackage') && !!packageDef.subpackage.length;

    Object.keys (packageDef).forEach (function (entry) {
      if (!controlMap.hasOwnProperty (entry)) {
        return;
      }

      var subPackages = '';

      var fctValue = function (it) {
        var result = packageDef[it];

        switch (it) {
        case 'name': {
          if (isInfo) {
            /* HACK: should be handle for several subpackages. */
            subPackages = '/' + packageDef.subpackage[0].replace (/\*/, '');
          }
          break;
        }

        case 'architecture': {
          if (arch === 'source') {
            result = '$(architecture())';
          } else {
            result = arch;
          }
          break;
        }

        case 'maintainer': {
          result = util.format ('"%s" <%s>',
                                packageDef[it].name,
                                packageDef[it].email);
          break;
        }

        case 'description': {
          result = util.format ('%s', packageDef[it].brief);
          if (packageDef[it].long.length > 0) {
            result += util.format ('\n  %s', packageDef[it].long);
          }
          break;
        }

        case 'dependency': {
          var cnt = 0;
          result = '';

          if (!packageDef[it].hasOwnProperty ('install')) {
            break;
          }

          Object.keys (packageDef[it].install).forEach (function (dep) {
            packageDef[it].install[dep].forEach (function (it) {
              result += util.format ('%s%s', cnt > 0 ? ', ' : '', dep);
              if (it.version.length > 0) {
                result += util.format (' (%s)', it.version);
              }
              if (it.architecture.length) {
                result += util.format (' [%s]', it.architecture.join (' '));
              }
              cnt++;
            });
          });
          break;
        }
        }

        return result.toString ().trim ();
      };

      var result = fctValue (entry);
      if (result.length > 0) {
        control += util.format ('%s%s: %s\n', controlMap[entry], subPackages, result);
      }
    });

    controlList[arch] = {
      data: control,
      info: isInfo
    };

    xLog.verb (util.format ('Control file (%s):\n%s', arch, control));
  });

  return controlList;
};

/**
 * Generate and save all control files accordingly to the config yaml files.
 *
 * @param {string} packageArch - null for all architectures.
 * @param {Object} packageDef - The package definitions.
 * @param {boolean} saveFiles - Saves the control files.
 * @returns {Object[]} The list of all control file paths.
 */
exports.controlFiles = function (packageArch, packageDef, saveFiles) {
  if (saveFiles) {
    xLog.info ('if necessary, save the control files for ' + packageDef.name);
  }

  var xcraftConfig = require ('xcraft-core-etc') ().load ('xcraft');
  var pacmanConfig = require ('xcraft-core-etc') ().load ('xcraft-contrib-pacman');
  var xFs          = require ('xcraft-core-fs');
  var utils        = require ('../utils.js');

  var fs = require ('fs');

  var control = defToControl (packageDef);
  var controlFiles = [];

  Object.keys (control).forEach (function (arch) {
    if (!utils.checkOsSupport (packageDef.name, packageArch, packageDef, arch)) {
      return;
    }

    var wpkgName = arch === 'source' ?
                   pacmanConfig.pkgWPKG.toLowerCase () :
                   pacmanConfig.pkgWPKG.toUpperCase ();
    var controlDir  = path.join (xcraftConfig.pkgTempRoot,
                                 arch, packageDef.name, wpkgName);

    var suffix = control[arch].info ? '.info' : '';
    var controlFile = path.join (controlDir, 'control' + suffix);

    if (saveFiles) {
      if (fs.existsSync (controlFile)) {
        xLog.warn ('the control file will be overwritten: ' + controlFile);
      }

      /* A directory by architecture is created. */
      xFs.mkdir (controlDir);
      fs.writeFileSync (controlFile, control[arch].data);
    }

    controlFiles.push ({
      arch:    arch,
      control: controlFile
    });
  });

  return controlFiles;
};
