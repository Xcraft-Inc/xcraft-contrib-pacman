'use strict';

var path = require ('path');

var utils        = require ('xcraft-core-utils');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

exports.load = function (packageName) {
  var pkgConfig = path.join (xcraftConfig.pkgProductsRoot,
                             packageName,
                             pacmanConfig.pkgCfgFileName);
  return utils.yamlFile2Json (pkgConfig);
};
