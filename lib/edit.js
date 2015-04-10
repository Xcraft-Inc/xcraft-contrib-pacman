'use strict';

var moduleName = 'manager';

var path  = require ('path');
var util  = require ('util');
var async = require ('async');

var xLog         = require ('xcraft-core-log') (moduleName);
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


/**
 * Convert an inquirer answer to a package definition.
 *
 * @param {string} pkgRepository
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @returns {Object} The zog package definition.
 */
var inquirerToPackage = function (pkgRepository, inquirerPkg) {
  var packageDef = {};

  inquirerPkg.forEach (function (it) {
    if (it.hasOwnProperty ('package')) {
      /* TODO: handle sub-packages with the wizard. */
      if (it.architecture.indexOf ('source') !== -1) {
        packageDef.subpackage = ['runtime*'];
      }

      packageDef.name              = it.package;
      packageDef.version           = it.version;
      packageDef.maintainer        = {};
      packageDef.maintainer.name   = it.maintainerName;
      packageDef.maintainer.email  = it.maintainerEmail;
      packageDef.architecture      = it.architecture;

      if (it.architecture.indexOf ('source') !== -1) {
        packageDef.architectureHost = it.architectureHost;
      }

      packageDef.description       = {};
      packageDef.description.brief = it.descriptionBrief;
      packageDef.description.long  = it.descriptionLong;
      packageDef.dependency        = {};
    } else if (it.hasOwnProperty ('uri')) {
      packageDef.data                = {};
      packageDef.data.get            = {};
      packageDef.data.get.uri        = it.uri;
      packageDef.data.get.out        = it.uriOut;
      packageDef.data.type           = it.fileType;
      packageDef.data.configure      = it.configureCmd;
      packageDef.data.rules          = {};
      packageDef.data.rules.type     = it.rulesType;
      packageDef.data.rules.location = it.rulesLocation || '';

      packageDef.data.rules.args                           = {};
      packageDef.data.rules.args[pacmanConfig.pkgPostinst] = it.rulesArgsPostinst || '';
      packageDef.data.rules.args[pacmanConfig.pkgPrerm]    = it.rulesArgsPrerm    || '';

      if (packageDef.architecture.indexOf ('source') !== -1) {
        packageDef.data.rules.args[pacmanConfig.pkgMakeall] = it.rulesArgsMakeall || '';
      }

      packageDef.data.path = it.registerPath ? [it.registerPath] : [];
      packageDef.data.embedded = it.embedded;
    } else {
      var depName = '';

      if (it.hasOwnProperty ('dependency/runtime')) {
        depName = 'dependency/runtime';
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
      packageDef.dependency[depType][it[depName]].push (it.version);
    }
  });

  packageDef.distribution = pkgRepository;

  return packageDef;
};

/**
 * Create a package template for the toolchain.
 *
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @param {Object} callbackInquirer
 * @param {Function(err, results)} callback
 */
exports.pkgTemplate = function (inquirerPkg, callbackInquirer, callback) {
  xLog.info ('create the package definition for ' + inquirerPkg[0].package);

  var packageDef = inquirerToPackage (pacmanConfig.pkgRepository, inquirerPkg);
  xLog.verb ('JSON output (package):\n' + JSON.stringify (packageDef, null, '  '));

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
      fs.mkdirSync (pkgDir, 493 /* 0755 */, function (err) {
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
      fs.writeFileSync (path.join (pkgDir, pacmanConfig.pkgCfgFileName), yamlPkg, null);
      callback ();
    }
  ], function (err, results) {
    if (err) {
      xLog.err (err);
    }

    callback (err, results[0]);
  });
};
