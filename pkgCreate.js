'use strict';

var moduleName = 'manager';

var path      = require ('path');
var util      = require ('util');
var async     = require ('async');
var zogLog    = require ('xcraft-core-log') (moduleName);
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
var chestConfig   = require ('xcraft-core-etc').load ('xcraft-contrib-chest');
var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
/**
 * Convert an inquirer answer to a package definition.
 * @param {string} pkgRepository
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @returns {Object} The zog package definition.
 */
var inquirerToPackage = function (pkgRepository, inquirerPkg) {
  var packageDef = {};

  inquirerPkg.forEach (function (it) {
    if (it.hasOwnProperty ('package')) {
      packageDef.name              = it.package;
      packageDef.version           = it.version;
      packageDef.maintainer        = {};
      packageDef.maintainer.name   = it.maintainerName;
      packageDef.maintainer.email  = it.maintainerEmail;
      packageDef.architecture      = it.architecture;
      packageDef.description       = {};
      packageDef.description.brief = it.descriptionBrief;
      packageDef.description.long  = it.descriptionLong;
      packageDef.dependency        = {};
    } else if (it.hasOwnProperty ('dependency')) {
      if (!util.isArray (packageDef.dependency[it.dependency])) {
        packageDef.dependency[it.dependency] = [];
      }
      packageDef.dependency[it.dependency].push (it.version);
    } else if (it.hasOwnProperty ('uri')) {
      packageDef.data                    = {};
      packageDef.data.uri                = it.uri;
      packageDef.data.type               = it.fileType;
      packageDef.data.rules              = {};
      packageDef.data.rules.type         = it.rulesType;
      packageDef.data.rules.location     = it.rulesLocation || '';
      packageDef.data.rules.args         = {};
      packageDef.data.rules.args.install = it.rulesArgsInstall || '';
      packageDef.data.rules.args.remove  = it.rulesArgsRemove || '';
      packageDef.data.embedded           = it.embedded;
    }
  });

  packageDef.distribution = packageDef.architecture[0] === 'source' ?
                            'sources/' :
                            pkgRepository;

  return packageDef;
};

/**
 * Create a package template for the toolchain.
 * @param {Object} inquirerPkg - The Inquirer answers.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.pkgTemplate = function (inquirerPkg, callbackDone) {
  zogLog.info ('create the package definition for ' + inquirerPkg[0].package);

  var packageDef = inquirerToPackage (pacmanConfig.pkgRepository, inquirerPkg);
  zogLog.verb ('JSON output (package):\n' + JSON.stringify (packageDef, null, '  '));

  var fs       = require ('fs');
  var url      = require ('url');
  var inquirer = require ('inquirer');
  var wizard   = require ('./wizard.js');
  var chestWizard = wizard.chest;

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

  /* The definitions can be writtent even if we are in inquirer for uploading
   * the resources in the chest server.
   */
  async.parallel ([
    function (callback) {
      /* We look for chest: and we propose to upload the file. */
      var urlObj = url.parse (packageDef.data.uri);
      if (urlObj.protocol !== 'chest:') {
        callback ();
        return;
      }

      var file = urlObj.pathname || urlObj.hostname;

      inquirer.prompt (chestWizard, function (answers) {
        /* Async */
        if (!answers.mustUpload) {
          callback ();
          return;
        }

        zogLog.info ('upload %s to chest://%s:%d/%s',
                     answers.localPath,
                     chestConfig.host,
                     chestConfig.port,
                     file);

        var chestClient = require ('../chest/chestClient.js');
        chestClient.upload (answers.localPath, function (error) {
          callback (error);
        });
      });
    },
    function (callback) {
      var yaml = require ('js-yaml');

      var yamlPkg = yaml.safeDump (packageDef);
      fs.writeFileSync (path.join (pkgDir, pacmanConfig.pkgCfgFileName), yamlPkg, null);
      callback ();
    }
  ], function (err) {
    if (err) {
      zogLog.err (err);
    }

    callbackDone (!err);
  });
};
