'use strict';

var moduleName = 'command';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var zogLog     = require ('xcraft-core-log') (moduleName);
var wpkgEngine = require ('./wpkgEngine.js');


var updateAndInstall = function (zogConfig, packageName, arch, callbackDone) {
  wpkgEngine.update (zogConfig, arch, function (done) {
    if (done) {
      wpkgEngine.install (zogConfig, packageName, arch, callbackDone);
    } else {
      callbackDone (false);
    }
  });
};

var addRepositoryForAll = function (zogConfig, packageName, arch, callbackDone) {
  /* This repository is useful for all architectures. */
  var allRespository = path.join (zogConfig.pkgDebRoot, 'all');

  if (fs.existsSync (allRespository)) {
    var source = util.format ('wpkg file://%s/ %s',
                              allRespository.replace (/\\/g, '/'),
                              zogConfig.pkgRepository);
    wpkgEngine.addSources (zogConfig, source, arch, function (done) {
      if (!done) {
        zogLog.err ('impossible to add the source path for "all"');
        callbackDone (false);
        return;
      }

      updateAndInstall (zogConfig, packageName, arch, callbackDone);
    });
  } else {
    updateAndInstall (zogConfig, packageName, arch, callbackDone);
  }
};

var parsePkgRef = function (packageRef) {
  return {
    name: packageRef.replace (/:.*/, ''),
    arch: packageRef.replace (/.*:/, '')
  };
};

var checkArch = function (zogConfig, arch) {
  if (zogConfig.architectures.indexOf (arch) === -1) {
    zogLog.err ('the architecture ' + arch + ' is unknown');
    return false;
  }

  return true;
};

exports.install = function (zogConfig, packageRef, callbackDone) {
  var pkg = parsePkgRef (packageRef);

  zogLog.verb ('install package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!checkArch (zogConfig, pkg.arch)) {
    callbackDone (false);
    return;
  }

  /* Check if the admindir exists; create if necessary. */
  if (fs.existsSync (path.join (zogConfig.pkgTargetRoot, pkg.arch, 'var', 'lib', 'wpkg'))) {
    addRepositoryForAll (zogConfig, pkg.name, pkg.arch, callbackDone);
    return;
  }

  wpkgEngine.createAdmindir (zogConfig, pkg.arch, function (done) {
    if (!done) {
      zogLog.err ('impossible to create the admin directory');
      callbackDone (false);
      return;
    }

    var source = util.format ('wpkg file://%s/ %s',
                              path.join (zogConfig.pkgDebRoot, pkg.arch).replace (/\\/g, '/'),
                              zogConfig.pkgRepository);
    wpkgEngine.addSources (zogConfig, source, pkg.arch, function (done) {
      if (!done) {
        zogLog.err ('impossible to add the source path for "%s"', pkg.arch);
        callbackDone (false);
        return;
      }

      addRepositoryForAll (zogConfig, pkg.name, pkg.arch, callbackDone);
    });
  });
};

exports.remove = function (zogConfig, packageRef, callbackDone) {
  var pkg = parsePkgRef (packageRef);

  zogLog.verb ('remove package name: ' + pkg.name + ' on architecture: ' + pkg.arch);

  if (!checkArch (zogConfig, pkg.arch)) {
    callbackDone (false);
    return;
  }

  wpkgEngine.remove (zogConfig, pkg.name, pkg.arch, callbackDone);
};
