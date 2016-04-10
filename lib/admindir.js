'use strict';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');

var utils = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


class AdminDir {
  constructor (response) {
    this._response = response;
  }

  _updateAndInstall (packageName, arch, callback) {
    wpkg.update (arch, this._response, (err) => {
      if (err) {
        callback (err);
      } else {
        callback (null, packageName, arch);
      }
    });
  }

  _addRepository (packageName, arch, callback) {
    const xcraftConfig = require ('xcraft-core-etc') (null, this._response).load ('xcraft');

    var repo = xcraftConfig.pkgDebRoot.replace (/\\/g, '/');

    var server  = path.dirname (repo);
    var distrib = path.basename (repo);

    if (!fs.existsSync (repo)) {
      this._updateAndInstall (packageName, arch, callback);
      return;
    }

    var source = util.format ('wpkg file://%s/ %s/',
                              server.replace (/\/$/, ''),
                              distrib);
    wpkg.addSources (source, arch, this._response, (err) => {
      if (err) {
        this._response.log.err ('impossible to add the source path');
        callback (err);
        return;
      }

      this._updateAndInstall (packageName, arch, callback);
    });
  }

  create (packageRef, callback) {
    const xcraftConfig = require ('xcraft-core-etc') (null, this._response).load ('xcraft');

    var pkg = utils.parsePkgRef (packageRef);

    this._response.log.verb ('create target for ' + (pkg.name || 'all') + ' on ' + pkg.arch);

    if (!utils.checkArch (pkg.arch)) {
      callback ('bad architecture');
      return;
    }

    /* Check if the admindir exists; create if necessary. */
    if (fs.existsSync (path.join (xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
      this._addRepository (pkg.name, pkg.arch, callback);
      return;
    }

    wpkg.createAdmindir (pkg.arch, this._response, (err) => {
      if (err) {
        this._response.log.err ('impossible to create the admin directory');
        callback (err);
        return;
      }

      this._addRepository (pkg.name, pkg.arch, callback);
    });
  }
}

module.exports = (response) => new AdminDir (response);
