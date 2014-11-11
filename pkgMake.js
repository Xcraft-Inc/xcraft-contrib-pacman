'use strict';

var moduleName = 'manager';

var path = require ('path');

var pkgControl    = require ('./pkgControl.js');
var pkgChangelog  = require ('./pkgChangelog.js');
var pkgDefinition = require ('./pkgDefinition.js');

var xFs          = require ('xcraft-core-fs');
var xLog         = require ('xcraft-core-log') (moduleName);
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

var copyTemplateFiles = function (packagePath, script, postInstDir) {
  var fs = require ('fs');

  var action = script.replace (/\..*$/, '');

  var scriptFileIn  = path.join (path.join (__dirname, './wpkg/'),
                                 pacmanConfig.pkgScript);
  var scriptFileOut = path.join (packagePath, pacmanConfig.pkgWPKG, script);

  var placeHolders = {
    __SHARE__  : path.relative (packagePath, postInstDir),
    __ACTION__ : action,
    __SYSROOT__: './',
    __CONFIG__ : 'etc/peon.json'
  };

  /* FIXME: experimental, not tested. */
  var data = fs.readFileSync (scriptFileIn, 'utf8');
  Object.keys (placeHolders).forEach (function (it) {
    data = data.replace (it, placeHolders[it]);
  });

  fs.writeFileSync (scriptFileOut, data, 'utf8');
};

var createConfigJson = function (packageName, postInstDir) {
  var fs   = require ('fs');
  var xUri = require ('xcraft-core-uri');

  var def = pkgDefinition.load (packageName);
  var config = def.data;

  config.uri = xUri.realUri (config.uri, packageName);

  var data = JSON.stringify (config, null, 2);
  var outFile = path.join (postInstDir, 'config.json');
  fs.writeFileSync (outFile, data, 'utf8');
};

var processFile = function (packageName, files, arch, callbackDone) {
  var i = 0;

  var wpkgEngine = require ('./wpkgEngine.js');

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

    var sharePath = path.join (packagePath, 'usr', 'share', namespace, name);
    xFs.mkdir (sharePath);

    var build = function () {
      var wpkgBuild = function (packageDef) {
        /* Don't copy pre/post scripts with unsupported architectures. */
        if (packageDef.architecture.indexOf ('all')    === -1 &&
            packageDef.architecture.indexOf ('source') === -1) {
          var scripts = [
            pacmanConfig.pkgPostinst,
            pacmanConfig.pkgPrerm
          ];

          scripts.forEach (function (it) {
            copyTemplateFiles (packagePath, it, sharePath);
          });
        }

        createConfigJson (packageName, sharePath);

        /* Build the package with wpkg. */
        wpkgEngine.build (packagePath, packageDef.distribution, function (error) { /* jshint ignore:line */
          /* When we reach the last item, then we have done all async work. */
          if (i === files.length - 1) {
            if (callbackDone) {
              callbackDone (true);
            }
          } else {
            i++;
            nextFile ();
          }
        });
      };

      var packageDef = pkgDefinition.load (packageName);

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
        xPeon[dataType][rulesType] (xUri.realUri (uri, packageName), packagePath, sharePath, {}, function (done) {
          if (done) {
            wpkgBuild (packageDef);
          } else {
            xLog.err ('can not build ' + packageName);
          }
        });
      } else {
        wpkgBuild (packageDef);
      }
    };

    /* Look for premake script. */
    try {
      var productPath = path.join (xcraftConfig.pkgProductsRoot, packageName);
      var premake = require (path.join (productPath, 'premake.js')) (packagePath, sharePath);
      premake.copy (function (done) {
        if (done) {
          build ();
        }
      });
    } catch (err) {
      /* FIXME: how to handle the case where an internal require fails? */
      if (err.code === 'MODULE_NOT_FOUND') {
        xLog.info ('no premake script for this package');
        build ();
      } else {
        xLog.err (err);
      }
    }
  };

  if (files.length) {
    nextFile ();
  } else if (callbackDone) {
    callbackDone (true);
  }
};

exports.package = function (packageName, arch, callbackDone) {
  try {
    pkgChangelog.changelogFiles (packageName, arch, true);
    var controlFiles = pkgControl.controlFiles (packageName, arch, true);

    processFile (packageName, controlFiles, arch, callbackDone);
  } catch (err) {
    xLog.err (err);
    callbackDone (false);
  }
};
