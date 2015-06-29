'use strict';

var moduleName = 'pacman/admindir';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var wpkg  = require ('./wpkg/wpkg.js');
var utils = require ('./utils.js');

var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
var xLog          = require ('xcraft-core-log') (moduleName);

require ('xcraft-core-buslog') (xLog);


var updateAndInstall = function (packageName, arch, callback) {
  wpkg.update (arch, function (err) {
    if (err) {
      callback (err);
    } else {
      callback (null, packageName, arch);
    }
  });
};

var addRepository = function (packageName, arch, callback) {
  var repo = xcraftConfig.pkgDebRoot.replace (/\\/g, '/');

  var server  = path.dirname (repo);
  var distrib = path.basename (repo);

  if (!fs.existsSync (repo)) {
    updateAndInstall (packageName, arch, callback);
    return;
  }

  var source = util.format ('wpkg file://%s/ %s/',
                            server.replace (/\/$/, ''),
                            distrib);
  wpkg.addSources (source, arch, function (err) {
    if (err) {
      xLog.err ('impossible to add the source path');
      callback (err);
      return;
    }

    updateAndInstall (packageName, arch, callback);
  });
};

exports.create = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.verb ('create target for ' + (pkg.name || 'all') + ' on ' + pkg.arch);

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  /* Check if the admindir exists; create if necessary. */
  if (fs.existsSync (path.join (xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
    addRepository (pkg.name, pkg.arch, callback);
    return;
  }

  wpkg.createAdmindir (pkg.arch, function (err) {
    if (err) {
      xLog.err ('impossible to create the admin directory');
      callback (err);
      return;
    }

    addRepository (pkg.name, pkg.arch, callback);
  });
};
