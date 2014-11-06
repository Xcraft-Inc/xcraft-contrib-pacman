'use strict';

var moduleName = 'command';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var wpkgEngine = require ('./wpkgEngine.js');

var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var xLog          = require ('xcraft-core-log') (moduleName);


var updateAndInstall = function (packageName, arch, callbackDone) {
  wpkgEngine.update (arch, function (done) {
    if (done) {
      wpkgEngine.install (packageName, arch, callbackDone);
    } else {
      callbackDone (false);
    }
  });
};

var addRepositoryForAll = function (packageName, arch, callbackDone) {
  /* This repository is useful for all architectures. */
  var allRespository = path.join (xcraftConfig.pkgDebRoot, 'all');

  if (fs.existsSync (allRespository)) {
    var source = util.format ('wpkg file://%s/ %s',
                              allRespository.replace (/\\/g, '/'),
                              pacmanConfig.pkgRepository);
    wpkgEngine.addSources (source, arch, function (done) {
      if (!done) {
        xLog.err ('impossible to add the source path for "all"');
        callbackDone (false);
        return;
      }

      updateAndInstall (packageName, arch, callbackDone);
    });
  } else {
    updateAndInstall (packageName, arch, callbackDone);
  }
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

exports.install = function (packageRef, callbackDone) {
  var pkg = parsePkgRef (packageRef);

  xLog.verb ('install package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!checkArch (pkg.arch)) {
    callbackDone (false);
    return;
  }

  /* Check if the admindir exists; create if necessary. */
  if (fs.existsSync (path.join (xcraftConfig.pkgTargetRoot, pkg.arch, 'var', 'lib', 'wpkg'))) {
    addRepositoryForAll (pkg.name, pkg.arch, callbackDone);
    return;
  }

  wpkgEngine.createAdmindir (pkg.arch, function (done) {
    if (!done) {
      xLog.err ('impossible to create the admin directory');
      callbackDone (false);
      return;
    }

    var source = util.format ('wpkg file://%s/ %s',
                              path.join (xcraftConfig.pkgDebRoot, pkg.arch).replace (/\\/g, '/'),
                              pacmanConfig.pkgRepository);
    wpkgEngine.addSources (source, pkg.arch, function (done) {
      if (!done) {
        xLog.err ('impossible to add the source path for "%s"', pkg.arch);
        callbackDone (false);
        return;
      }

      addRepositoryForAll (pkg.name, pkg.arch, callbackDone);
    });
  });
};

exports.remove = function (packageRef, callbackDone) {
  var pkg = parsePkgRef (packageRef);

  xLog.verb ('remove package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!checkArch (pkg.arch)) {
    callbackDone (false);
    return;
  }

  wpkgEngine.remove (pkg.name, pkg.arch, callbackDone);
};
