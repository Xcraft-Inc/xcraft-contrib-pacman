'use strict';

var moduleName = 'manager';

var path = require ('path');
var util = require ('util');

var xLog = require ('xcraft-core-log') (moduleName);


var pad = function (n, w) {
  n = n + '';
  return n.length >= w ? n : new Array (w - n.length + 1).join ('0') + n;
};

var timestamp = function () {
  var date = new Date ();
  var d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var offset = date.getTimezoneOffset () / 60;
  var sign = '+';
  if (offset < 0) {
    sign = '-';
    offset = -offset;
  }

  return util.format ('%s, %s %s %d %s:%s:%s %s%s\n',
                      d[date.getDay ()],
                      pad (date.getDate (), 2),
                      m[date.getMonth ()],
                      date.getFullYear (),
                      pad (date.getHours (), 2),
                      pad (date.getMinutes (), 2),
                      pad (date.getSeconds (), 2),
                      sign,
                      pad (offset, 4));
};

/**
 * Generate and save all ChangeLog files accordingly to the config.yaml files.
 *
 * @param {string} packageName
 * @param {string} packageArch
 */
exports.changelogFiles = function (packageName, packageArch) {
  var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var xFs           = require ('xcraft-core-fs');
  var xPh           = require ('xcraft-core-placeholder');

  var fs         = require ('fs');
  var utils      = require ('../utils.js');
  var definition = require ('../definition.js');

  var packageDef = definition.load (packageName);

  packageDef.architecture.forEach (function (arch) {
    if (!utils.checkOsSupport (packageName, packageArch, arch)) {
      return;
    }

    var wpkgName = arch === 'source' ?
                   pacmanConfig.pkgWPKG.toLowerCase () :
                   pacmanConfig.pkgWPKG.toUpperCase ();
    var wpkgDir = path.join (xcraftConfig.pkgTempRoot,
                             arch, packageDef.name, wpkgName);

    var fileIn  = path.join (__dirname, '../templates/ChangeLog');
    var fileOut = path.join (wpkgDir, 'ChangeLog');

    if (fs.existsSync (fileOut)) {
      xLog.warn ('the ChangeLog file will be overwritten: ' + fileOut);
    }

    xFs.mkdir (wpkgDir);

    var ph = new xPh.Placeholder ();
    ph.set ('PACKAGE.NAME',             packageDef.name)
      .set ('PACKAGE.VERSION',          packageDef.version)
      .set ('PACKAGE.DISTRIBUTION',     packageDef.distribution)
      .set ('PACKAGE.ARCHITECTURE',     arch)
      .set ('PACKAGE.MAINTAINER.NAME',  packageDef.maintainer.name)
      .set ('PACKAGE.MAINTAINER.EMAIL', packageDef.maintainer.email)
      .set ('TIMESTAMP',                timestamp ())
      .injectFile ('PACMAN', fileIn, fileOut);
  });
};
