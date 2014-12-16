'use strict';

var moduleName = 'build';

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var xLog = require ('xcraft-core-log') (moduleName);


exports.package = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.verb ('compile package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    var definition = require ('./definition.js');
    var packageDef = definition.load (packageName);

    wpkg.buildFromSrc (packageName + '-src', arch, packageDef.distribution, callback);
  });
};
