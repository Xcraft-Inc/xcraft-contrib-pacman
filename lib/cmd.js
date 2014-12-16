'use strict';

var moduleName = 'command';

var wpkg     = require ('./wpkg/wpkg.js');
var utils    = require ('./utils.js');
var admindir = require ('./admindir.js');

var xLog = require ('xcraft-core-log') (moduleName);


exports.install = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.verb ('install package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  admindir.create (packageRef, function (err, packageName, arch) {
    if (err) {
      callback (err);
      return;
    }

    wpkg.install (packageName, arch, callback);
  });
};

exports.remove = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.verb ('remove package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  wpkg.remove (pkg.name, pkg.arch, callback);
};
