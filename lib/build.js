'use strict';

var moduleName = 'build';

var wpkg  = require ('./wpkg/wpkg.js');
var utils = require ('./utils.js');

var xLog = require ('xcraft-core-log') (moduleName);

exports.package = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.verb ('compile package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  var definition = require ('./definition.js');
  var packageDef = definition.load (pkg.name);

  wpkg.buildFromSrc (pkg.name + '-src', pkg.arch, packageDef.distribution, callback);
};
