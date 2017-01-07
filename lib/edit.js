'use strict';

var path  = require ('path');
var util  = require ('util');
var async = require ('async');


/**
 * Convert an inquirer answer to a package definition.
 *
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @returns {Object} The zog package definition.
 */
var inquirerToPackage = function (inquirerPkg, response) {
  const pacmanConfig = require ('xcraft-core-etc') (null, response).load ('xcraft-contrib-pacman');

  var packageDef = {};

  inquirerPkg.forEach (function (it) {
    if (it.hasOwnProperty ('package')) {
      /* TODO: handle sub-packages with the wizard. */
      if (it.architecture.indexOf ('source') !== -1) {
        packageDef.subpackage = ['runtime*'];
      }

      packageDef.name              = it.package;
      packageDef.version           = it.version;
      packageDef.distribution      = it.tool ? pacmanConfig.pkgToolchainRepository : pacmanConfig.pkgProductsRepository;
      packageDef.maintainer        = {};
      packageDef.maintainer.name   = it.maintainerName;
      packageDef.maintainer.email  = it.maintainerEmail;
      packageDef.architecture      = it.architecture;
      packageDef.description       = {};
      packageDef.description.brief = it.descriptionBrief;
      packageDef.description.long  = it.descriptionLong;
      packageDef.dependency        = {};
    } else if (it.hasOwnProperty ('fileType')) {
      packageDef.data                = {};
      packageDef.data.get            = {};
      packageDef.data.get.uri        = it.uri || '';
      packageDef.data.get.ref        = it.uriRef || '';
      packageDef.data.get.out        = it.uriOut || '';
      packageDef.data.type           = it.fileType;
      packageDef.data.configure      = it.configureCmd || '';
      packageDef.data.rules          = {};
      packageDef.data.rules.type     = it.rulesType;
      packageDef.data.rules.test     = it.rulesTest;
      packageDef.data.rules.location = it.rulesLocation || '';

      packageDef.data.rules.args                           = {};
      packageDef.data.rules.args.postinst = it.rulesArgsPostinst || '';
      packageDef.data.rules.args.prerm    = it.rulesArgsPrerm    || '';

      if (packageDef.architecture.indexOf ('source') !== -1) {
        packageDef.data.rules.args.makeall     = it.rulesArgsMakeall     || '';
        packageDef.data.rules.args.maketest    = it.rulesArgsMaketest    || '';
        packageDef.data.rules.args.makeinstall = it.rulesArgsMakeinstall || '';
        packageDef.data.deploy = it.deployCmd || '';
      }

      packageDef.data.env        = {};
      packageDef.data.env.path   = it.registerPath ? it.registerPath.split (',') : [];

      if (it.rulesType === 'meta') {
        it.embedded = true;
      }

      packageDef.data.embedded = !!it.embedded;

      if (packageDef.architecture.indexOf ('source') !== -1) {
        packageDef.data.runtime           = {};
        packageDef.data.runtime.configure = it.runtimeConfigureCmd;
      }
    } else if (it.hasOwnProperty ('key')) {
      if (!packageDef.data.env.other) {
        packageDef.data.env.other = {};
      }

      if (it.key.length) {
        packageDef.data.env.other[it.key] = it.value || '';
      }
    } else {
      var depName = '';

      if (it.hasOwnProperty ('dependency/install')) {
        depName = 'dependency/install';
      } else if (it.hasOwnProperty ('dependency/build')) {
        depName = 'dependency/build';
      } else {
        return;
      }

      var depType = depName.replace (/.*\//, '');

      if (!packageDef.dependency[depType]) {
        packageDef.dependency[depType] = {};
      }
      if (!util.isArray (packageDef.dependency[depType][it[depName]])) {
        packageDef.dependency[depType][it[depName]] = [];
      }
      packageDef.dependency[depType][it[depName]].push ({
        version:      it.version,
        architecture: it.architecture || []
      });
    }
  });

  return packageDef;
};

/**
 * Create a package template for the toolchain.
 *
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @param {Object} response
 * @param {Object} callbackInquirer
 * @param {function(err, results)} callback
 */
exports.pkgTemplate = function (inquirerPkg, response, callbackInquirer, callback) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');
  const pacmanConfig = require ('xcraft-core-etc') (null, response).load ('xcraft-contrib-pacman');

  response.log.info ('create the package definition for ' + inquirerPkg[0].package);

  var packageDef = inquirerToPackage (inquirerPkg, response);

  var fs  = require ('fs');
  var url = require ('url');

  var pkgDir = path.join (xcraftConfig.pkgProductsRoot, packageDef.name);

  try {
    var st = fs.statSync (pkgDir);

    if (!st.isDirectory ()) {
      var err = new Error (pkgDir + ' exists and it is not a directory');
      throw err;
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync (pkgDir, /* 0755 */ 493, function (err) {
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
  async.parallel ([
    function (callback) {
      /* We look for chest: and we propose to upload the file. */
      var urlObj = url.parse (packageDef.data.get.uri);
      if (urlObj.protocol !== 'chest:' || !callbackInquirer) {
        callback (null, false);
        return;
      }

      var file = urlObj.pathname || urlObj.hostname;
      callbackInquirer ('chest', file);
      callback (null, true);
    },
    function (callback) {
      var yaml = require ('js-yaml');

      var yamlPkg = yaml.safeDump (packageDef);
      fs.writeFileSync (path.join (pkgDir, pacmanConfig.pkgCfgFileName), yamlPkg, 'utf8');
      callback ();
    }
  ], function (err, results) {
    if (err) {
      response.log.err (err);
    }

    callback (err, results[0]);
  });
};
