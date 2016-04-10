'use strict';

var path = require ('path');

var xFs          = require ('xcraft-core-fs');


class Clean {
  constructor (response) {
    this._response = response;

    this._xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');
  }

  temp (packageName) {
    this._response.log.info ('Clean %s package%s.',
                             packageName || 'all',
                             packageName ? '' : 's');

    var tmpDir = this._xcraftConfig.pkgTempRoot;

    try {
      xFs.lsdir (tmpDir).forEach (function (archDir) {
        if (!packageName) {
          xFs.rm (path.join (tmpDir, archDir));
          return;
        }

        xFs.rm (path.join (tmpDir, archDir, packageName));
      });
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw (ex);
      }
    }
  }
}

module.exports = (response) => new Clean (response);
