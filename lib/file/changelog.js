'use strict';

var path = require('path');
var util = require('util');

var pad = function (n, w) {
  n = n + '';
  return n.length >= w ? n : new Array(w - n.length + 1).join('0') + n;
};

var timestamp = function () {
  var date = new Date();
  var d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var m = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  var offset = date.getTimezoneOffset() / 60;
  var sign = '+';
  if (offset < 0) {
    sign = '-';
    offset = -offset;
  }

  return util.format(
    '%s, %s %s %d %s:%s:%s %s%s\n',
    d[date.getDay()],
    pad(date.getDate(), 2),
    m[date.getMonth()],
    date.getFullYear(),
    pad(date.getHours(), 2),
    pad(date.getMinutes(), 2),
    pad(date.getSeconds(), 2),
    sign,
    pad(offset, 4)
  );
};

/**
 * Generate and save all ChangeLog files accordingly to the config yaml files.
 *
 * @param {string} packageArch - Architecture.
 * @param {Object} packageDef - The package definitions.
 * @param {string} [distribution] - Distribution or null
 * @param {*} resp - Response
 */
exports.changelogFiles = function (
  packageArch,
  packageDef,
  distribution,
  resp
) {
  var xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  var pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );
  var xFs = require('xcraft-core-fs');
  var xPh = require('xcraft-core-placeholder');

  var fs = require('fs');
  var utils = require('../utils.js');

  packageDef.architecture.forEach(function (arch) {
    if (!utils.checkOsSupport(packageDef.name, packageArch, packageDef, arch)) {
      return;
    }

    var wpkgName =
      arch === 'source'
        ? pacmanConfig.pkgWPKG.toLowerCase()
        : pacmanConfig.pkgWPKG.toUpperCase();
    var wpkgDir = path.join(
      xcraftConfig.pkgTempRoot,
      arch,
      packageDef.name,
      wpkgName
    );

    var fileIn = path.join(__dirname, '../templates/ChangeLog');
    var fileOut = path.join(wpkgDir, 'ChangeLog');

    if (fs.existsSync(fileOut)) {
      resp.log.warn('the ChangeLog file will be overwritten: ' + fileOut);
    }

    xFs.mkdir(wpkgDir);

    const distributions =
      distribution.indexOf('+') !== -1
        ? [distribution]
        : utils.getDistributions(packageDef);

    var ph = new xPh.Placeholder();
    ph.set('NAME', packageDef.name)
      .set('VERSION', packageDef.version)
      .set('DISTRIBUTION', distributions.join(' '))
      .set('ARCHITECTURE', arch)
      .set('MAINTAINER.NAME', packageDef.maintainer.name)
      .set('MAINTAINER.EMAIL', packageDef.maintainer.email)
      .set('TIMESTAMP', timestamp())
      .injectFile('PACKAGE', fileIn, fileOut);
  });
};
