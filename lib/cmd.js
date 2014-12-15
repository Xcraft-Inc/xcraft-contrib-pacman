'use strict';

var moduleName = 'command';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var wpkg  = require ('./wpkg/wpkg.js');
var utils = require ('./utils.js');

var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var xLog          = require ('xcraft-core-log') (moduleName);


var updateAndInstall = function (packageName, arch, callback) {
  wpkg.update (arch, function (err) {
    if (err) {
      callback (err);
    } else {
      wpkg.install (packageName, arch, callback);
    }
  });
};

var addRepositoriesForAll = function (packageName, arch, callback) {
  var async = require ('async');

  /* These repositories are useful for all architectures. */
  var archs = ['all', 'source'];

  async.eachSeries (archs, function (fromArch, callback) {
    var repository = path.join (xcraftConfig.pkgDebRoot, fromArch);

    if (!fs.existsSync (repository)) {
      callback ();
      return;
    }

    var source = util.format ('wpkg file://%s/ %s',
                              repository.replace (/\\/g, '/'),
                              fromArch === 'source' ? 'sources/' : pacmanConfig.pkgRepository);
    wpkg.addSources (source, arch, function (err) {
      if (err) {
        xLog.err ('impossible to add the source path for "' + fromArch + '"');
      }

      callback (err);
    });
  }, function (err) {
    if (!err) {
      updateAndInstall (packageName, arch, callback);
    } else {
      callback (err);
    }
  });
};

exports.install = function (packageRef, callback) {
  var pkg = utils.parsePkgRef (packageRef);

  xLog.verb ('install package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  /* Check if the admindir exists; create if necessary. */
  if (fs.existsSync (path.join (xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
    addRepositoriesForAll (pkg.name, pkg.arch, callback);
    return;
  }

  wpkg.createAdmindir (pkg.arch, function (err) {
    if (err) {
      xLog.err ('impossible to create the admin directory');
      callback (err);
      return;
    }

    var repo = path.join (xcraftConfig.pkgDebRoot, pkg.arch).replace (/\\/g, '/');
    if (!fs.existsSync (repo)) {
      addRepositoriesForAll (pkg.name, pkg.arch, callback);
      return;
    }

    var source = util.format ('wpkg file://%s/ %s',
                              repo,
                              pacmanConfig.pkgRepository);
    wpkg.addSources (source, pkg.arch, function (err) {
      if (err) {
        xLog.err ('impossible to add the source path for "%s"', pkg.arch);
        callback (err);
        return;
      }

      addRepositoriesForAll (pkg.name, pkg.arch, callback);
    });
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
