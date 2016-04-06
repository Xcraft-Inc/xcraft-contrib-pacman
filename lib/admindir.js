'use strict';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var utils = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


var updateAndInstall = function (packageName, arch, response, callback) {
  wpkg.update (arch, response, function (err) {
    if (err) {
      callback (err);
    } else {
      callback (null, packageName, arch);
    }
  });
};

var addRepository = function (packageName, arch, response, callback) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');

  var repo = xcraftConfig.pkgDebRoot.replace (/\\/g, '/');

  var server  = path.dirname (repo);
  var distrib = path.basename (repo);

  if (!fs.existsSync (repo)) {
    updateAndInstall (packageName, arch, response, callback);
    return;
  }

  var source = util.format ('wpkg file://%s/ %s/',
                            server.replace (/\/$/, ''),
                            distrib);
  wpkg.addSources (source, arch, response, function (err) {
    if (err) {
      response.log.err ('impossible to add the source path');
      callback (err);
      return;
    }

    updateAndInstall (packageName, arch, response, callback);
  });
};

exports.create = function (packageRef, response, callback) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');

  var pkg = utils.parsePkgRef (packageRef);

  response.log.verb ('create target for ' + (pkg.name || 'all') + ' on ' + pkg.arch);

  if (!utils.checkArch (pkg.arch)) {
    callback ('bad architecture');
    return;
  }

  /* Check if the admindir exists; create if necessary. */
  if (fs.existsSync (path.join (xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
    addRepository (pkg.name, pkg.arch, response, callback);
    return;
  }

  wpkg.createAdmindir (pkg.arch, response, function (err) {
    if (err) {
      response.log.err ('impossible to create the admin directory');
      callback (err);
      return;
    }

    addRepository (pkg.name, pkg.arch, response, callback);
  });
};
