'use strict';

var moduleName = 'pacman/clean';

var path = require ('path');

var xFs          = require ('xcraft-core-fs');
var xcraftConfig = require ('xcraft-core-etc') ().load ('xcraft');
var xLog         = require ('xcraft-core-log') (moduleName);


exports.temp = function (packageName, callback) {
  xLog.info ('Clean %s package%s.',
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
