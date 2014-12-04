'use strict';

var moduleName = 'manager';

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
    name        : 'Package',
    subpackage  : 'Sub-Packages',
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
    var isInfo = packageDef.hasOwnProperty ('subpackage');

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
          result = '';
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
 * Generate and save all control files accordingly to the config.yaml files.
 *
 * @param {string} packageName
 * @param {string} packageArch - null for all architectures.
 * @param {boolean} saveFiles - Saves the control files.
 * @returns {Object[]} The list of all control file paths.
 */
exports.controlFiles = function (packageName, packageArch, saveFiles) {
  if (saveFiles) {
    xLog.info ('if necessary, save the control files for ' + packageName);
  }

  var fs  = require ('fs');
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var xFs           = require ('xcraft-core-fs');
  var xPlatform     = require ('xcraft-core-platform');
  var definition    = require ('../definition.js');

  var def     = definition.load (packageName);
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
      arch   : arch,
      control: controlFile
    });
  });

  return controlFiles;
};
