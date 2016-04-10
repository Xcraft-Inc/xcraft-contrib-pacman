'use strict';

var fs   = require ('fs');
var path = require ('path');
var util = require ('util');
const watt = require ('watt');

var utils = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


class AdminDir {
  constructor (response) {
    this._response = response;

    this._xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');

    watt.wrapAll (this);
  }

  * _updateAndInstall (packageName, arch, next) {
    yield wpkg.update (arch, this._response, next);
    return {
      name: packageName,
      arch: arch
    };
  }

  * _addRepository (packageName, arch, next) {
    var repo = this._xcraftConfig.pkgDebRoot.replace (/\\/g, '/');

    var server  = path.dirname (repo);
    var distrib = path.basename (repo);

    if (!fs.existsSync (repo)) {
      return yield this._updateAndInstall (packageName, arch);
    }

    var source = util.format ('wpkg file://%s/ %s/',
                              server.replace (/\/$/, ''),
                              distrib);
    try {
      yield wpkg.addSources (source, arch, this._response, next);
      return yield this._updateAndInstall (packageName, arch);
    } catch (ex) {
      this._response.log.err ('impossible to add the source path');
      throw ex;
    }
  }

  * create (packageRef, next) {
    var pkg = utils.parsePkgRef (packageRef);

    this._response.log.verb ('create target for ' + (pkg.name || 'all') + ' on ' + pkg.arch);

    if (!utils.checkArch (pkg.arch)) {
      throw 'bad architecture';
    }

    /* Check if the admindir exists; create if necessary. */
    if (fs.existsSync (path.join (this._xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
      return yield this._addRepository (pkg.name, pkg.arch);
    }

    try {
      yield wpkg.createAdmindir (pkg.arch, this._response, next);
      return yield this._addRepository (pkg.name, pkg.arch);
    } catch (ex) {
      this._response.log.err ('impossible to create the admin directory');
      throw ex;
    }
  }
}

module.exports = (response) => new AdminDir (response);
