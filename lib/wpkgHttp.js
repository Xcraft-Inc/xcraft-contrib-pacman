'use static';

const moduleName = 'wpkg-http';

const path = require('path');
const express = require('express');
const chokidar = require('chokidar');
const watt = require('gigawatts');
const fs = require('fs');

class WpkgHttp {
  constructor(port = 80, hostname = '127.0.0.1') {
    const xConfig = require('xcraft-core-etc')().load('xcraft');
    const xPacmanConfig = require('xcraft-core-etc')().load(
      'xcraft-contrib-pacman'
    );

    this._xLog = require('xcraft-core-log')(moduleName, null);
    this._app = express();
    this._port = port;
    this._hostname = hostname;
    this._xPacmanConfig = xPacmanConfig;
    this._varRoot = path.join(xConfig.xcraftRoot, 'var');
    this._repositories = [];
    this._registered = {};

    this._app.use('*', (req, res, next) => {
      let [, base, distribution, ...other] = req.baseUrl.split('/');

      /* Handle distribution fallback */
      if (base === 'versions' && distribution.indexOf('+') !== -1) {
        let distribDir = path.join(this._varRoot, 'wpkg@ver', distribution);
        if (!fs.existsSync(distribDir)) {
          distribution = distribution.split('+')[0];
          distribDir = path.join(
            this._varRoot,
            'wpkg@ver',
            distribution.split('+')[0]
          );
          res.redirect(['', base, distribution, ...other].join('/'));
          return;
        }
      }

      next();
    });

    this._watcher = chokidar
      .watch(path.join(this._varRoot, 'wpkg*'), {depth: 1})
      .on('addDir', (dir) => this._refreshRepository(dir));

    watt.wrapAll(this);
  }

  _refreshRepository(dir) {
    if (/wpkg\.?[a-z@]*(?!-ar)$/.test(dir)) {
      this._refreshRoute(dir);
    }
  }

  _refreshRoute(repository) {
    let route;
    const distribution = repository.split('.');
    if (path.basename(repository) !== 'wpkg@ver') {
      route =
        '/' +
        (distribution.length === 2
          ? distribution[1]
          : this._xPacmanConfig.pkgToolchainRepository.replace(/\//, ''));
    } else {
      route = '/versions';
    }
    if (!this._registered[route]) {
      this._addRoute(repository, route);
    }
  }

  _addRoute(dirPath, webRoute) {
    this._xLog.verb(
      `add ${this._hostname}:${this._port}${webRoute} for ${dirPath}`
    );
    this._app.use(
      webRoute,
      express.static(dirPath, {index: this._xPacmanConfig.pkgIndex})
    );
    this._registered[webRoute] = true;
  }

  serve() {
    this._server = this._app.listen(this._port, this._hostname);
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
