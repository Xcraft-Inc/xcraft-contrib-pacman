'use strict';

var path = require('path');
var async = require('async');

/**
 * Convert an inquirer answer to a package definition.
 *
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @returns {Object} The zog package definition.
 */
var inquirerToPackage = function (inquirerPkg, resp) {
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  var packageDef = {};

  inquirerPkg.forEach(function (it) {
    if (it.hasOwnProperty('package')) {
      if (it.hasOwnProperty('subPackages')) {
        packageDef.subpackage = it.subPackages;
      }
      packageDef.name = it.package;
      packageDef.version = it.version;
      packageDef.$version = it.version
        .replace(/-[0-9]+$/, '')
        .replace('~', '-');
      packageDef.distribution = it.tool
        ? pacmanConfig.pkgToolchainRepository
        : it.distribution;
      packageDef.maintainer = {};
      packageDef.maintainer.name = it.maintainerName;
      packageDef.maintainer.email = it.maintainerEmail;
      packageDef.architecture = it.architecture;
      packageDef.description = {};
      packageDef.description.brief = it.descriptionBrief;
      packageDef.description.long = it.descriptionLong;
      packageDef.dependency = {};
    } else if (it.hasOwnProperty('fileType')) {
      packageDef.data = {};
      packageDef.data.get = {};
      packageDef.data.get.uri = it.uri || '';
      packageDef.data.get.ref = it.uriRef || '';
      packageDef.data.get.out = it.uriOut || '';
      packageDef.data.get.externals = it.uriExternals || false;

      if (packageDef.architecture.indexOf('source') !== -1) {
        packageDef.data.get.prepare = it.prepareCmd || '';
      }

      packageDef.data.type = it.fileType;
      packageDef.data.configure = it.configureCmd || '';
      packageDef.data.rules = {};
      packageDef.data.rules.type = it.rulesType;
      packageDef.data.rules.location = it.rulesLocation || '';

      packageDef.data.rules.args = {};
      packageDef.data.rules.args.postinst = it.rulesArgsPostinst || '';
      packageDef.data.rules.args.prerm = it.rulesArgsPrerm || '';

      if (packageDef.architecture.indexOf('source') !== -1) {
        packageDef.data.rules.test = it.rulesTest || '';
        packageDef.data.rules.args.makeall = it.rulesArgsMakeall || '';
        packageDef.data.rules.args.maketest = it.rulesArgsMaketest || '';
        packageDef.data.rules.args.makeinstall = it.rulesArgsMakeinstall || '';
        packageDef.data.deploy = it.deployCmd || '';
      }

      packageDef.data.env = {};
      packageDef.data.env.path = it.registerPath
        ? it.registerPath.split(',')
        : [];
      if (it.registerPathSub) {
        const subs = JSON.parse(it.registerPathSub);
        Object.keys(subs).forEach((sub) => {
          packageDef.data.env[`path/${sub}`] = subs[sub].split(',');
        });
      }

      if (it.rulesType === 'meta') {
        it.embedded = true;
      }

      packageDef.data.embedded = !!it.embedded;

      if (packageDef.architecture.indexOf('source') !== -1) {
        packageDef.data.runtime = {};
        packageDef.data.runtime.configure = it.runtimeConfigureCmd || '';
      }
    } else if (it.hasOwnProperty('key0')) {
      if (!packageDef.data.env.other) {
        packageDef.data.env.other = {};
      }

      if (it.key0.length) {
        packageDef.data.env.other[it.key0] = it.value || '';
      }
    } else if (it.hasOwnProperty('key1')) {
      if (!packageDef.data.rules.env) {
        packageDef.data.rules.env = {};
      }

      if (it.key1.length) {
        packageDef.data.rules.env[it.key1] = it.value || '';
      }
    } else {
      var depName = '';

      if (it.hasOwnProperty('dependency/install')) {
        depName = 'dependency/install';
      } else if (it.hasOwnProperty('dependency/build')) {
        depName = 'dependency/build';
      } else if (it.hasOwnProperty('dependency/make')) {
        depName = 'dependency/make';
      } else {
        return;
      }

      var depType = depName.replace(/.*\//, '');

      if (!packageDef.dependency[depType]) {
        packageDef.dependency[depType] = {};
      }
      if (!Array.isArray(packageDef.dependency[depType][it[depName]])) {
        packageDef.dependency[depType][it[depName]] = [];
      }
      const dep = {
        version: it.version,
        architecture: it.architecture || [],
      };
      if (it.subPackages && it.subPackages.length > 1) {
        dep.subpackage = it.subPackages.split(',');
      }
      packageDef.dependency[depType][it[depName]].push(dep);
    }
  });

  return packageDef;
};

/**
 * Create a package template for the toolchain.
 *
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @param {Object} resp
 * @param {Object} callbackInquirer
 * @param {function(err, results)} callback
 */
exports.pkgTemplate = function (inquirerPkg, resp, callbackInquirer, callback) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  resp.log.info('create the package definition for ' + inquirerPkg[0].package);

  var packageDef = inquirerToPackage(inquirerPkg, resp);

  var fs = require('fs');
  var url = require('url');

  var pkgDir = path.join(xcraftConfig.pkgProductsRoot, packageDef.name);

  try {
    var st = fs.statSync(pkgDir);

    if (!st.isDirectory()) {
      var err = new Error(pkgDir + ' exists and it is not a directory');
      throw err;
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(pkgDir, /* 0755 */ 493, function (err) {
        if (err) {
          throw err;
        }
      });
    } else {
      throw err;
    }
  }

  /* The definitions can be written even if we are in inquirer for uploading
   * the resources in the chest server.
   */
  async.parallel(
    [
      function (callback) {
        /* We look for chest: and we propose to upload the file. */
        var urlObj = url.parse(packageDef.data.get.uri);
        if (urlObj.protocol !== 'chest:' || !callbackInquirer) {
          callback(null, false);
          return;
        }

        var file = urlObj.pathname || urlObj.hostname;
        callbackInquirer('chest', file);
        callback(null, true);
      },
      function (callback) {
        var yaml = require('js-yaml');

        var yamlPkg = yaml.safeDump(packageDef, {lineWidth: 999});
        fs.writeFileSync(
          path.join(pkgDir, pacmanConfig.pkgCfgFileName),
          yamlPkg,
          'utf8'
        );
        callback();
      },
    ],
    function (err, results) {
      if (err) {
        resp.log.err(err);
      }

      callback(err, results[0]);
    }
  );
};
