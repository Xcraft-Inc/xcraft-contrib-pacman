'use strict';

var path = require ('path');

var xFs          = require ('xcraft-core-fs');
var busLog       = require ('xcraft-core-buslog');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');


exports.temp = function (packageName, callback) {
  busLog.info ('Clean %s package%s.',
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
