'use strict';

var moduleName = 'manager';

var path      = require ('path');
var util      = require ('util');
var zogLog    = require ('xcraft-core-log') (moduleName);


var pad = function (n, w) {
  n = n + '';
  return n.length >= w ? n : new Array (w - n.length + 1).join ('0') + n;
};

/**
 * Convert a zog package definition to a ChangeLog file.
 * @param {Object} packageDef
 * @returns {string} A ChangeLog file.
 */
var defToChangelog = function (packageDef) {
  var changelogList = {};

  packageDef.architecture.forEach (function (arch) {
    var changelog = '';

    changelog = util.format ('%s (%s) %s; urgency=low\n\n',
                             packageDef.name,
                             packageDef.version,
                             packageDef.distribution);
    changelog += '  * Package for ' + arch + '.\n';
    changelog += util.format ('\n -- %s <%s>  ',
                              packageDef.maintainer.name,
                              packageDef.maintainer.email);

    var date = new Date ();
    var d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var offset = date.getTimezoneOffset () / 60;
    var sign = '+';
    if (offset < 0) {
      sign = '-';
      offset = -offset;
    }

    changelog += util.format ('%s, %s %s %d %s:%s:%s %s%s\n',
                              d[date.getDay ()],
                              pad (date.getDate (), 2),
                              m[date.getMonth ()],
                              date.getFullYear (),
                              pad (date.getHours (), 2),
                              pad (date.getMinutes (), 2),
                              pad (date.getSeconds (), 2),
                              sign,
                              pad (offset, 4));

    changelogList[arch] = changelog;

    zogLog.verb (util.format ('ChangeLog file:\n%s', changelog));
  });

  return changelogList;
};

/**
 * Generate and save all ChangeLog files accordingly to the config.yaml files.
 * @param {string} packageName
 * @param {string} packageArch
 * @param {boolean} saveFiles - Saves the control files.
 * @returns {string[]} The list of all control file paths.
 */
exports.changelogFiles = function (packageName, packageArch, saveFiles) {
  if (saveFiles) {
    zogLog.info ('if necessary, save the ChangeLog file for ' + packageName);
  }

  var fs = require ('fs');
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var zogFs         = require ('xcraft-core-fs');
  var pkgDefinition = require ('./pkgDefinition.js');

  var def       = pkgDefinition.load (packageName);
  var changelog = defToChangelog (def);

  var changelogFiles = [];

  Object.keys (changelog).forEach (function (arch) {
    if (packageArch && arch !== packageArch) {
      return;
    }

    var wpkgDir       = path.join ( xcraftConfig.pkgTempRoot,
                                    arch,
                                    packageName,
                                    pacmanConfig.pkgWPKG
                                  );
    var changelogFile = path.join (wpkgDir, 'ChangeLog');

    if (saveFiles) {
      if (fs.existsSync (changelogFile)) {
        zogLog.warn ('the ChangeLog file will be overwritten: ' + changelogFile);
      }

      zogFs.mkdir (wpkgDir);
      fs.writeFileSync (changelogFile, changelog[arch]);
    }

    changelogFiles.push ({
      arch   : arch,
      control: changelogFile
    });
  });

  return changelogFiles;
};
