'use strict';

var utils    = require ('./utils.js');

var wpkg = require ('xcraft-contrib-wpkg');


class Install {
  constructor (response) {
    this._response = response;

    this._admindir = require ('./admindir.js') (response);
  }

  package (packageRef, reinstall, callback) {
    var pkg = utils.parsePkgRef (packageRef);

    this._response.log.info ('Install %s package%s on %s.',
                             pkg.name || 'all',
                             pkg.name ? '' : 's',
                             pkg.arch || 'all architectures');

    this._admindir.create (packageRef, function (err, res) {
      if (err) {
        callback (err);
        return;
      }

      wpkg.install (res.name, res.arch, reinstall, this._response, callback);
    });
  }

  status (packageRef, callback) {
    var pkg = utils.parsePkgRef (packageRef);

    wpkg.isInstalled (pkg.name, pkg.arch, this._response, function (err, isInstalled) {
      this._response.log.info ('The package %s is %sinstalled in %s.',
                               pkg.name, !isInstalled ? 'not ' : '', pkg.arch);
      callback (err, isInstalled);
    });
  }
}

module.exports = (response) => new Install (response);
