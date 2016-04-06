'use strict';

var path = require ('path');

var xFs          = require ('xcraft-core-fs');


exports.temp = function (packageName, response, callback) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');

  response.log.info ('Clean %s package%s.',
                     packageName || 'all',
                     packageName ? '' : 's');

  var tmpDir = xcraftConfig.pkgTempRoot;

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
      callback (ex);
      return;
    }
  }

  callback ();
};
