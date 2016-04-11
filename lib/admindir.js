'use strict';

const fs   = require ('fs');
const path = require ('path');
const watt = require ('watt');

const utils = require ('./utils.js');



class AdminDir {
  constructor (response) {
    this._response = response;

    this._xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');
    this._wpkg         = require ('xcraft-contrib-wpkg') (response);

    watt.wrapAll (this);
  }

  * _updateAndInstall (packageName, arch, next) {
    yield this._wpkg.update (arch, next);
    return {
      name: packageName,
      arch: arch
    };
  }

  * _addRepository (packageName, arch, next) {
    const repo = this._xcraftConfig.pkgDebRoot.replace (/\\/g, '/');

    const server  = path.dirname (repo);
    const distrib = path.basename (repo);

    if (!fs.existsSync (repo)) {
      return yield this._updateAndInstall (packageName, arch);
    }

    const source = `wpkg file://${server.replace (/\/$/, '')}/ ${distrib}/`;
    try {
      yield this._wpkg.addSources (source, arch, next);
      return yield this._updateAndInstall (packageName, arch);
    } catch (ex) {
      this._response.log.err ('impossible to add the source path');
      throw ex;
    }
  }

  * create (packageRef, next) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.verb (`create target for ${pkg.name || 'all'} on ${pkg.arch}`);

    if (!utils.checkArch (pkg.arch)) {
      throw 'bad architecture';
    }

    /* Check if the admindir exists; create if necessary. */
    if (fs.existsSync (path.join (this._xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
      return yield this._addRepository (pkg.name, pkg.arch);
    }

    try {
      yield this._wpkg.createAdmindir (pkg.arch, next);
      return yield this._addRepository (pkg.name, pkg.arch);
    } catch (ex) {
      this._response.log.err ('impossible to create the admin directory');
      throw ex;
    }
  }
}

module.exports = (response) => new AdminDir (response);
