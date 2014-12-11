'use strict';

var moduleName = 'command';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var wpkg = require ('./wpkg/wpkg.js');

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

var addRepositoryForAll = function (packageName, arch, callback) {
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

var parsePkgRef = function (packageRef) {
  return {
    name: packageRef.replace (/:.*/, ''),
    arch: packageRef.replace (/.*:/, '')
  };
};

var checkArch = function (arch) {
  if (pacmanConfig.architectures.indexOf (arch) === -1) {
    xLog.err ('the architecture ' + arch + ' is unknown');
    return false;
  }

  return true;
};

exports.install = function (packageRef, callback) {
  var pkg = parsePkgRef (packageRef);

  xLog.verb ('install package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  /* Check if the admindir exists; create if necessary. */
  if (fs.existsSync (path.join (xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
    addRepositoryForAll (pkg.name, pkg.arch, callback);
    return;
  }

  wpkg.createAdmindir (pkg.arch, function (err) {
    if (err) {
      xLog.err ('impossible to create the admin directory');
      callback (err);
      return;
    }

    var source = util.format ('wpkg file://%s/ %s',
                              path.join (xcraftConfig.pkgDebRoot, pkg.arch).replace (/\\/g, '/'),
                              pacmanConfig.pkgRepository);
    wpkg.addSources (source, pkg.arch, function (err) {
      if (err) {
        xLog.err ('impossible to add the source path for "%s"', pkg.arch);
        callback (err);
        return;
      }

      addRepositoryForAll (pkg.name, pkg.arch, callback);
    });
  });
};

exports.remove = function (packageRef, callback) {
  var pkg = parsePkgRef (packageRef);

  xLog.verb ('remove package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  wpkg.remove (pkg.name, pkg.arch, callback);
};
