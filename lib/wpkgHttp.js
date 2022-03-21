'use static';

const path = require('path');
const express = require('express');
const chokidar = require('chokidar');
const watt = require('gigawatts');

class WpkgHttp {
  constructor(port = 80) {
    const xConfig = require('xcraft-core-etc')().load('xcraft');
    const xPacmanConfig = require('xcraft-core-etc')().load(
      'xcraft-contrib-pacman'
    );

    this._app = express();
    this._port = port;
    this._xPacmanConfig = xPacmanConfig;
    this._varRoot = path.join(xConfig.xcraftRoot, 'var');
    this._repositories = [];
    this._registered = {};

    this._watcher = chokidar
      .watch(path.join(this._varRoot, 'wpkg*'))
      .on('addDir', (dir) => this._refreshRepository(dir));

    watt.wrapAll(this);
  }

  _refreshRepository(dir) {
    if (/wpkg\.?[a-z]*(?!-ar)$/.test(dir)) {
      this._refreshRoute(dir);
    }
  }

  _refreshRoute(repository) {
    const distribution = repository.split('.');
    const route =
      '/' +
      (distribution.length === 2
        ? distribution[1]
        : this._xPacmanConfig.pkgToolchainRepository.replace(/\//, ''));
    if (!this._registered[route]) {
      this._addRoute(repository, route);
    }
  }

  _addRoute(dirPath, webRoute) {
    this._app.use(
      webRoute,
      express.static(dirPath, {index: this._xPacmanConfig.pkgIndex})
    );
    this._registered[webRoute] = true;
  }

  serve() {
    this._server = this._app.listen(this._port);
  }

  *dispose(next) {
    if (this._server) {
      this._server.close(next.parallel());
    }
    this._watcher.close(next.parallel());
    yield next.sync();
  }
}

module.exports = WpkgHttp;
