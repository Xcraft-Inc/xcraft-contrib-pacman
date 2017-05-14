'use strict';

var path = require ('path');
var util = require ('util');

/**
 * Generate and save all config files accordingly to the config yaml files.
 *
 * @param {string} packageArch
 * @param {Object} packageDef - The package definitions.
 */
exports.etcFiles = function (packageArch, packageDef, response) {
  var xcraftConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft'
  );
  var xFs = require ('xcraft-core-fs');

  var fs = require ('fs');
  var utils = require ('../utils.js');

  packageDef.architecture.forEach (function (arch) {
    if (
      !utils.checkOsSupport (packageDef.name, packageArch, packageDef, arch)
    ) {
      return;
    }

    Object.keys (packageDef.data.env)
      .filter (key => {
        return typeof packageDef.data.env[key] === 'object'
          ? !!Object.keys (packageDef.data.env[key]).length
          : !!packageDef.data.env[key].length;
      })
      .forEach (key => {
        var data = JSON.stringify (packageDef.data.env[key], null, 2);

        response.log.verb (util.format (`Config file for ${key}:\n%s`, data));

        var etcDir = path.join (
          xcraftConfig.pkgTempRoot,
          arch,
          packageDef.name,
          'etc/env',
          key
        );
        var fileOut = path.join (etcDir, packageDef.name + '.json');

        if (fs.existsSync (fileOut)) {
          response.log.warn (
            'the copyright file will be overwritten: ' + fileOut
          );
        }

        xFs.mkdir (etcDir);
        fs.writeFileSync (fileOut, utils.injectThisPh (packageDef, data));
      });
  });
};
