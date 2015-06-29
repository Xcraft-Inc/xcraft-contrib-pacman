'use strict';

var moduleName = 'pacman/def';

var path = require ('path');

var traverse     = require ('traverse');
var utils        = require ('xcraft-core-utils');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var xLog         = require ('xcraft-core-log') (moduleName);

require ('xcraft-core-buslog') (xLog);


/**
 * Load a package definition.
 *
 * @param {string} packageName
 * @param {Object} props - Overloaded properties with values.
 * @returns {Object} The package definition.
 */
exports.load = function (packageName, props) {
  packageName = packageName.replace (/-src$/, '');

  var pkgConfig = path.join (xcraftConfig.pkgProductsRoot,
                             packageName,
                             pacmanConfig.pkgCfgFileName);

  var data = null;
  try {
    data = utils.yamlFile2Json (pkgConfig);
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      xLog.warn ('the package %s does not exists', packageName);
    }
    throw ex;
  }

  if (!props) {
    return data;
  }

  var traversed = traverse (data);

  /* Overload properties accordingly to props. */
  Object.keys (props).forEach (function (prop) {
    var path = prop.split ('.');
    if (traversed.has (path)) {
      xLog.verb ('overload property %s with the value %s', prop, props[prop]);
      traversed.set (path, props[prop]);
    }
  });

  return data;
};
