'use strict';

var moduleName = 'manager';

var path  = require ('path');
var async = require ('async');

var definition = require ('./definition.js');

var xFs          = require ('xcraft-core-fs');
var xLog         = require ('xcraft-core-log') (moduleName);
var xPlatform    = require ('xcraft-core-platform');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

var copyTemplateFiles = function (packagePath, script, postInstDir, sysRoot, inWpkg) {
  var fs = require ('fs');

  var action = script.replace (/\..*$/, '');
  var ext    = xPlatform.getShellExt ();

  var scriptFileIn  = path.join (path.join (__dirname, './wpkg/'),
                                 pacmanConfig.pkgScript + ext);
  var scriptFileOut = path.join (packagePath, inWpkg ? pacmanConfig.pkgWPKG : '',
                                 script + ext);

  var placeHolders = {
    __SHARE__  : path.relative (packagePath, postInstDir),
    __ACTION__ : action,
    __SYSROOT__: sysRoot,
    __CONFIG__ : 'etc/peon.json'
  };

  var data = fs.readFileSync (scriptFileIn, 'utf8');
  Object.keys (placeHolders).forEach (function (it) {
    data = data.replace (it, placeHolders[it]);
  });

  fs.writeFileSync (scriptFileOut, data, 'utf8');

  /* chmod +x flag for Unix, ignored on Windows. */
  fs.chmodSync (scriptFileOut, 493 /* 0755 */);
};

var createConfigJson = function (packageName, postInstDir) {
  var fs   = require ('fs');
  var xUri = require ('xcraft-core-uri');

  var def = definition.load (packageName);
  var config = def.data;

  config.uri = xUri.realUri (config.uri, packageName);

  var data = JSON.stringify (config, null, 2);
  var outFile = path.join (postInstDir, 'config.json');
  fs.writeFileSync (outFile, data, 'utf8');
};

var processFile = function (packageName, files, arch, callback) {
  var i = 0;

  var wpkg = require ('./wpkg/wpkg.js');

  var nextFile = function () {
    var controlFile = files[i].control;

    xLog.info ('process ' + controlFile);

    var packagePath = path.resolve (path.dirname (controlFile), '..');

    /* Reserved directory for the post-installer. */
    var namespace = '';
    var name = packageName;
    var fullName = packageName.match (/(.*)\+(.*)/);
    if (fullName) {
      namespace = fullName[1];
      name      = fullName[2];
    }

    var sharePath = path.join (packagePath, 'usr/share', namespace, name);
    xFs.mkdir (sharePath);

    var wpkgBuild = function (packageDef) {
      /* Don't copy pre/post scripts with unsupported architectures. */
      if (packageDef.architecture.indexOf ('all') === -1) {
        var scripts = [];
        var inWpkg = true;
        var sysRoot = './';

        if (packageDef.architecture.indexOf ('source') === -1) {
          scripts = [
          pacmanConfig.pkgPostinst,
          pacmanConfig.pkgPrerm
          ];
        } else {
          scripts = [pacmanConfig.pkgMakeall];
          inWpkg = false;
          sysRoot = '../../../';
        }

        scripts.forEach (function (it) {
          copyTemplateFiles (packagePath, it, sharePath, sysRoot, inWpkg);
        });
      }

      createConfigJson (packageName, sharePath);

      /* Build the package with wpkg. */
      var action = packageDef.architecture.indexOf ('source') === -1 ? 'build' : 'buildSrc';
      wpkg[action] (packagePath, packageDef.distribution, function (err) {
        /* When we reach the last item, then we have done all async work. */
        if (i === files.length - 1) {
          if (callback) {
            callback (err);
          }
        } else {
          i++;
          nextFile ();
        }
      });
    };

    var build = function (callback) {
      var packageDef = definition.load (packageName);

      /* Are the resources embedded in the package (less than 1GB)? */
      if (packageDef.data.embedded && packageDef.data.uri.length) {
        var xPeon = require ('xcraft-core-peon');
        var xUri  = require ('xcraft-core-uri');

        var dataType  = packageDef.data.type;
        var rulesType = packageDef.data.rules.type;
        var uri       = packageDef.data.uri;

        /* NOTE: even with the 'exec' rule, we prevent to pass the binary to
         *       execute because here we are not installing, but only packaging.
         */
        xPeon[dataType][rulesType] (xUri.realUri (uri, packageName), packagePath, sharePath, {}, function (err) {
          callback (err, packageDef);
        });
      } else {
        callback (null, packageDef);
      }
    };

    var productPath = path.join (xcraftConfig.pkgProductsRoot, packageName);

    async.auto ({
      taskPrepeon: function (callback)  {
        try {
          var prepeon = require (path.join (productPath, 'prepeon.js')) (packagePath, sharePath);
          prepeon.copy (callback);
        } catch (err) {
          /* FIXME: how to handle the case where an internal require fails? */
          if (err.code === 'MODULE_NOT_FOUND') {
            xLog.info ('no prepeon script for this package');
            callback ();
          } else {
            xLog.err (err);
            callback (err);
          }
        }
      },
      taskPeon: ['taskPrepeon', function (callback) {
        build (callback);
      }],
      taskPostpeon: ['taskPeon', function (callback) {
        try {
          var postpeon = require (path.join (productPath, 'postpeon.js')) (packagePath, sharePath);
          postpeon.copy (callback);
        } catch (err) {
          /* FIXME: how to handle the case where an internal require fails? */
          if (err.code === 'MODULE_NOT_FOUND') {
            xLog.info ('no postpeon script for this package');
            callback ();
          } else {
            xLog.err (err);
            callback (err);
          }
        }
      }],
      taskBuildPackage: ['taskPostpeon', function (err, results) {
        wpkgBuild (results.taskPeon);
      }]
    }, callback);
  };

  if (files.length) {
    nextFile ();
  } else if (callback) {
    callback ();
  }
};

exports.package = function (packageName, arch, callback) {
  var control    = require ('./file/control.js');
  var changelog  = require ('./file/changelog.js');
  var copyright  = require ('./file/copyright.js');
  var cmakelists = require ('./file/cmakelists.js');

  try {
    changelog.changelogFiles (packageName, arch, true);
    copyright.copyrightFiles (packageName, arch, true);
    cmakelists.cmakelistsFile (packageName, arch, true);
    var controlFiles = control.controlFiles (packageName, arch, true);

    processFile (packageName, controlFiles, arch, callback);
  } catch (err) {
    callback (err);
  }
};
