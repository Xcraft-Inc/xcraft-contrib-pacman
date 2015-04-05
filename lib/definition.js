'use strict';

var moduleName = 'pacman';

var path = require ('path');

var utils        = require ('xcraft-core-utils');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var xLog         = require ('xcraft-core-log') (moduleName);

exports.load = function (packageName) {
  var pkgConfig = path.join (xcraftConfig.pkgProductsRoot,
                             packageName,
                             pacmanConfig.pkgCfgFileName);

  try {
    return utils.yamlFile2Json (pkgConfig);
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      xLog.warn ('the package %s does not exists', packageName);
    }
    throw ex;
  }
};
