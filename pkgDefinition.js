'use strict';

var moduleName = 'manager';

var path      = require ('path');
var utils     = require ('xcraft-core-utils');
var zogLog    = require ('xcraft-core-log') (moduleName);
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

exports.load = function (packageName) {
  var pkgConfig = path.join (xcraftConfig.pkgProductsRoot,
                             packageName,
                             pacmanConfig.pkgCfgFileName);

  var def = utils.yamlFile2Json (pkgConfig);
  zogLog.verb ('JSON output (package):\n' + JSON.stringify (def, null, '  '));

  return def;
};
