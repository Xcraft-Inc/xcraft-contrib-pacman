'use strict';

var moduleName = 'manager';

var path      = require ('path');
var zogLog    = require ('xcraft-core-log') (moduleName);
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');

exports.load = function (packageName) {
  var pkgConfig = path.join ( xcraftConfig.pkgProductsRoot,
                              packageName,
                              xcraftConfig.pkgCfgFileName
                            );

  var yaml = require ('js-yaml');
  var fs   = require ('fs');

  var data = fs.readFileSync (pkgConfig, 'utf8');

  var def = yaml.safeLoad (data);
  zogLog.verb ('JSON output (package):\n' + JSON.stringify (def, null, '  '));

  return def;
};
