'use strict';

var path = require ('path');

var utils        = require ('xcraft-core-utils');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var busLog       = require ('xcraft-core-buslog');

exports.load = function (packageName) {
  var pkgConfig = path.join (xcraftConfig.pkgProductsRoot,
                             packageName,
                             pacmanConfig.pkgCfgFileName);

  try {
    return utils.yamlFile2Json (pkgConfig);
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      busLog.warn ('The package %s does not exists.', packageName);
    }
    throw ex;
  }
};
