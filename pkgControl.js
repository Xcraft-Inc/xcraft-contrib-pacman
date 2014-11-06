'use strict';

var moduleName = 'manager';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);


/**
 * Convert a zog package definition to control definitions.
 * @param {Object} packageDef
 * @returns {Object[]} A control definition by architecture.
 */
var defToControl = function (packageDef) {
  var controlMap = {
    name        : 'Package',
    version     : 'Version',
    architecture: 'Architecture',
    maintainer  : 'Maintainer',
    description : 'Description',
    dependency  : 'Depends',
    distribution: 'Distribution'
  };

  var controlList = {};

  packageDef.architecture.forEach (function (arch) {
    var control = '';

    Object.keys (packageDef).forEach (function (entry) {
      if (!controlMap.hasOwnProperty (entry)) {
        return;
      }

      var fctValue = function (it) {
        var result = '';
        switch (it) {
        case 'architecture': {
          result = arch;
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
          Object.keys (packageDef[it]).forEach (function (dep) {
            packageDef[it][dep].forEach (function (version) {
              result += util.format ('%s%s', cnt > 0 ? ', ' : '', dep);
              if (version.length > 0) {
                result += util.format (' (%s)', version);
              }
              cnt++;
            });
          });
          break;
        }

        default: {
          if (!packageDef.hasOwnProperty (it)) {
            return;
          }

          result = packageDef[it];
          break;
        }
        }

        return result.toString ().trim ();
      };

      var result = fctValue (entry);
      if (result.length > 0) {
        control += util.format ('%s: %s\n', controlMap[entry], result);
      }
    });

    controlList[arch] = control;

    xLog.verb (util.format ('Control file (%s):\n%s', arch, control));
  });

  return controlList;
};

/**
 * Generate and save all control files accordingly to the config.yaml files.
 * @param {string} packageName
 * @param {string} packageArch - null for all architectures.
 * @param {boolean} saveFiles - Saves the control files.
 * @returns {string[]} The list of all control file paths.
 */
exports.controlFiles = function (packageName, packageArch, saveFiles) {
  if (saveFiles) {
    xLog.info ('if necessary, save the control files for ' + packageName);
  }

  var fs  = require ('fs');
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var zogFs         = require ('xcraft-core-fs');
  var xPlatform     = require ('xcraft-core-platform');
  var pkgDefinition = require ('./pkgDefinition.js');

  var def     = pkgDefinition.load (packageName);
  var control = defToControl (def);

  var controlFiles = [];

  Object.keys (control).forEach (function (arch) {
    if (packageArch && arch !== packageArch) {
      return;
    }

    /* Check OS support; we consider that Windows packages can be built only
     * with Windows. The first reason is the post/pre scripts which have not the
     * same name that on unix (.bat suffix under Windows).
     */
    var os = xPlatform.getOs ();
    if (!/^(all|source)$/.test (arch) &&
        (os === 'win' && !/^mswindows/.test (arch) ||
         os !== 'win' &&  /^mswindows/.test (arch))) {
      xLog.warn ('package \'%s\' for %s unsupported on %s',
                   packageName, arch, os);
      return;
    }

    var controlDir  = path.join (xcraftConfig.pkgTempRoot,
                                 arch,
                                 packageName,
                                 pacmanConfig.pkgWPKG);

    var controlFile = path.join (controlDir, 'control');

    if (saveFiles) {
      if (fs.existsSync (controlFile)) {
        xLog.warn ('the control file will be overwritten: ' + controlFile);
      }

      /* A directory by architecture is created. */
      zogFs.mkdir (controlDir);
      fs.writeFileSync (controlFile, control[arch]);
    }

    controlFiles.push ({
      arch   : arch,
      control: controlFile
    });
  });

  return controlFiles;
};
