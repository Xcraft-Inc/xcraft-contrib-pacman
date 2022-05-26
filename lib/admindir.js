'use strict';

const fs = require('fs');
const path = require('path');
const watt = require('gigawatts');

const utils = require('./utils.js');

const xPlatform = require('xcraft-core-platform');
const xPh = require('xcraft-core-placeholder');
const xPacman = require('..');

const definition = require('./def.js');
const {getDebRoot, getTargetRoot} = require('./index.js');

class AdminDir {
  constructor(resp) {
    this._resp = resp;

    const xEtc = require('xcraft-core-etc')(null, resp);
    this._pacmanConfig = xEtc.load('xcraft-contrib-pacman');
    this._xcraftConfig = xEtc.load('xcraft');
    this._wpkg = require('xcraft-contrib-wpkg')(resp);

    watt.wrapAll(this);
  }

  *_updateAndInstall(packageName, arch, targetRoot, next) {
    yield this._wpkg.update(arch, targetRoot, next);
    return {
      name: packageName,
      arch: arch,
    };
  }

  *_addRepository(packageName, arch, distribution, targetRoot, next) {
    const repo = getDebRoot(distribution, this._resp).replace(/\\/g, '/');

    const server = path.dirname(repo);
    const distrib = path.basename(repo);

    if (!fs.existsSync(repo)) {
      return yield this._updateAndInstall(packageName, arch, targetRoot);
    }

    const source = `wpkg file://${server
      .replace(/\+/g, '%2B')
      .replace(/\/$/, '')}/ ${distrib}/`;

    try {
      yield this._wpkg.addSources(source, arch, targetRoot, next);
      return yield this._updateAndInstall(packageName, arch, targetRoot);
    } catch (ex) {
      this._resp.log.err('impossible to add the source path');
      throw ex;
    }
  }

  _copyTemplate(action, distribution) {
    const ext = xPlatform.getShellExt();
    const scriptFileIn = path.join(
      path.join(__dirname, './templates/'),
      this._pacmanConfig.pkgScript + ext
    );
    const scriptFileOut = path.join(
      this._xcraftConfig.tempRoot,
      `${action}${ext}`
    );

    const ph = new xPh.Placeholder();
    ph.set('NAME', '')
      .set('VERSION', '')
      .set('SHARE', '')
      .set('HOOK', 'global')
      .set('ACTION', action)
      .set('SYSROOT', './')
      .set('DISTRIBUTION', distribution || '')
      .injectFile('PACMAN', scriptFileIn, scriptFileOut);

    /* chmod +x flag for Unix, ignored on Windows. */
    fs.chmodSync(scriptFileOut, 493 /* 0755 */);
    return scriptFileOut;
  }

  _makeSource(uri, location, components) {
    let source = `wpkg ${uri
      .replace(/\+/g, '%2B')
      .replace(/\/$/, '')}/ ${location.replace(/\/$/, '')}`;
    if (components && components.length) {
      source += components ? ` ${components.join(' ')}` : '/';
    }
    return source;
  }

  *addSource(uri, arch, distribution, location, components, next) {
    const repo = getDebRoot(distribution, this._resp).replace(/\\/g, '/');

    const targetRoot = getTargetRoot(distribution, this._resp);

    if (!fs.existsSync(repo)) {
      throw new Error(
        `it's not possible to add a new source to an unavailable admindir`
      );
    }

    const source = this._makeSource(uri, location ?? distribution, components);
    yield this._wpkg.addSources(source, arch, targetRoot, next);
  }

  *delSource(uri, arch, distribution, location, components, next) {
    const repo = getDebRoot(distribution, this._resp).replace(/\\/g, '/');

    const targetRoot = getTargetRoot(distribution, this._resp);

    if (!fs.existsSync(repo)) {
      return;
    }

    const source = this._makeSource(uri, location ?? distribution, components);
    yield this._wpkg.removeSources(source, arch, targetRoot, next);
  }

  *registerHooks(arch, distribution, next) {
    const hooks = [];

    ['postrm', 'postinst'].forEach((action) =>
      hooks.push(this._copyTemplate(action, distribution))
    );
    yield this._wpkg.addHooks(hooks, arch, distribution, next);
  }

  *create(packageRef, targetRoot, distribution, next) {
    const pkg = utils.parsePkgRef(packageRef);

    this._resp.log.verb(
      `create target for ${pkg.name || 'all'} on ${pkg.arch}`
    );

    if (!utils.checkArch(pkg.arch)) {
      throw 'bad architecture';
    }

    if (targetRoot && !distribution) {
      const def = definition.load(pkg.name, null, this._resp);
      distribution = def.distribution;
    }

    if (!targetRoot) {
      targetRoot = xPacman.getTargetRoot(distribution, this._resp);
    }

    /* Check if the admindir exists; create if necessary. */
    if (fs.existsSync(path.join(targetRoot, pkg.arch, 'var/lib/wpkg'))) {
      yield this.registerHooks(pkg.arch, distribution);
      return yield this._addRepository(
        pkg.name,
        pkg.arch,
        distribution,
        targetRoot
      );
    }

    try {
      yield this._wpkg.createAdmindir(pkg.arch, distribution, targetRoot, next);
      yield this.registerHooks(pkg.arch, distribution);
      return yield this._addRepository(
        pkg.name,
        pkg.arch,
        distribution,
        targetRoot
      );
    } catch (ex) {
      this._resp.log.err('impossible to create the admin directory');
      throw ex;
    }
  }
}

module.exports = (resp) => new AdminDir(resp);
