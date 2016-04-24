'use strict';

const fs   = require ('fs');
const path = require ('path');
const watt = require ('watt');

const utils = require ('./utils.js');

const xPlatform = require ('xcraft-core-platform');
const xPh       = require ('xcraft-core-placeholder');


class AdminDir {
  constructor (response) {
    this._response = response;

    const xEtc = require ('xcraft-core-etc') (null, response);
    this._pacmanConfig = xEtc.load ('xcraft-contrib-pacman');
    this._xcraftConfig = xEtc.load ('xcraft');
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

  _copyTemplate (action) {
    const ext = xPlatform.getShellExt ();
    const scriptFileIn  = path.join (path.join (__dirname, './templates/'),
    this._pacmanConfig.pkgScript + ext);
    const scriptFileOut = path.join (this._xcraftConfig.tempRoot, `${action}${ext}`);

    const ph = new xPh.Placeholder ();
    ph.set ('NAME',    '')
      .set ('VERSION', '')
      .set ('SHARE',   '')
      .set ('HOOK',    'global')
      .set ('ACTION',  action)
      .set ('SYSROOT', './')
      .set ('CONFIG',  './etc/peon.json')
      .injectFile ('PACMAN', scriptFileIn, scriptFileOut);

    /* chmod +x flag for Unix, ignored on Windows. */
    fs.chmodSync (scriptFileOut, 493 /* 0755 */);
    return scriptFileOut;
  }

  * registerHooks (arch, next) {
    const hooks = [];

    ['postrm', 'postinst'].forEach ((action) => hooks.push (this._copyTemplate (action)));
    yield this._wpkg.addHooks (hooks, arch, next);
  }

  * create (packageRef, next) {
    const pkg = utils.parsePkgRef (packageRef);

    this._response.log.verb (`create target for ${pkg.name || 'all'} on ${pkg.arch}`);

    if (!utils.checkArch (pkg.arch)) {
      throw 'bad architecture';
    }

    /* Check if the admindir exists; create if necessary. */
    if (fs.existsSync (path.join (this._xcraftConfig.pkgTargetRoot, pkg.arch, 'var/lib/wpkg'))) {
      yield this.registerHooks (pkg.arch);
      return yield this._addRepository (pkg.name, pkg.arch);
    }

    try {
      yield this._wpkg.createAdmindir (pkg.arch, next);
      yield this.registerHooks (pkg.arch);
      return yield this._addRepository (pkg.name, pkg.arch);
    } catch (ex) {
      this._response.log.err ('impossible to create the admin directory');
      throw ex;
    }
  }
}

module.exports = (response) => new AdminDir (response);
