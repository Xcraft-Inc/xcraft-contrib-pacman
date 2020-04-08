'use strict';

const path = require('path');

const xFs = require('xcraft-core-fs');

class Clean {
  constructor(resp) {
    this._resp = resp;

    this._xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  }

  temp(packageName) {
    this._resp.log.info(
      'Clean %s package%s.',
      packageName || 'all',
      packageName ? '' : 's'
    );

    const tmpDir = this._xcraftConfig.pkgTempRoot;

    try {
      xFs.lsdir(tmpDir).forEach(function (archDir) {
        if (!packageName) {
          xFs.rm(path.join(tmpDir, archDir));
          return;
        }

        xFs.rm(path.join(tmpDir, archDir, packageName));
      });
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
}

module.exports = (resp) => new Clean(resp);
