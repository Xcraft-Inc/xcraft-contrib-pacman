'use strict';

var moduleName = 'pacman/make';

var fs    = require ('fs');
var path  = require ('path');
var async = require ('async');

var utils      = require ('./utils');

var xFs          = require ('xcraft-core-fs');
var xLog         = require ('xcraft-core-log') (moduleName);
var xPlatform    = require ('xcraft-core-platform');
var busClient    = require ('xcraft-core-busclient').getGlobal ();
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
var xPh          = require ('xcraft-core-placeholder');


var copyTemplateFiles = function (packagePath, script, sharePath, sysRoot, isSource) {
  var action = script.replace (/\..*$/, '');
  var ext    = isSource ? xPlatform.getShellExtArray () : [xPlatform.getShellExt ()];

  ext.forEach (function (fileExt) {
    var scriptFileIn  = path.join (path.join (__dirname, './templates/'),
                                   pacmanConfig.pkgScript + fileExt);
    var scriptFileOut = path.join (packagePath, !isSource ? pacmanConfig.pkgWPKG : '',
                                   script + fileExt);

    var ph = new xPh.Placeholder ();
    ph.set ('SHARE',   path.relative (packagePath, sharePath))
      .set ('ACTION',  action)
      .set ('SYSROOT', sysRoot)
      .set ('CONFIG',  'etc/peon.json')
      .injectFile ('PACMAN', scriptFileIn, scriptFileOut);

    /* chmod +x flag for Unix, ignored on Windows. */
    fs.chmodSync (scriptFileOut, 493 /* 0755 */);
  });
};

var createConfigJson = function (packageDef, postInstDir) {
  var xUri = require ('xcraft-core-uri');

  var config = packageDef.data;

  config.get.uri = xUri.realUri (config.get.uri, packageDef.name);

  var data = JSON.stringify (config, null, 2);
  var outFile = path.join (postInstDir, 'config.json');

  fs.writeFileSync (outFile, utils.injectThisPh (packageDef, data), 'utf8');
};

var build = function (packageDef, packagePath, sharePath, callback) {
  /* Are the resources embedded in the package (less than 1GB)? */
  if (!packageDef.data.embedded || !packageDef.data.get.uri.length) {
    callback ();
  }

  var xPeon = require ('xcraft-contrib-peon');
  var xUri  = require ('xcraft-core-uri');

  var dataType  = packageDef.data.type;
  var rulesType = packageDef.data.rules.type;
  var getObj    = packageDef.data.get;

  getObj.uri = xUri.realUri (utils.injectThisPh (packageDef, packageDef.data.get.uri), packageDef.name);

  /* NOTE: even with the 'exec' rule, we prevent to pass the binary to
   *       execute because here we are not installing, but only packaging.
   */
  var extra = {
    configure:     utils.injectThisPh (packageDef, packageDef.data.configure),
    location:      utils.injectThisPh (packageDef, packageDef.data.rules.location),
    embedded:      packageDef.data.embedded,
    onlyPackaging: true
  };

  xPeon[dataType][rulesType] (getObj, packagePath, sharePath, extra, callback);
};

var wpkgBuild = function (packageDef, packagePath, sharePath, callback) {
  var wpkg = require ('xcraft-contrib-wpkg');

  /* Don't copy pre/post scripts with unsupported architectures. */
  if (packageDef.architecture.indexOf ('all') === -1) {
    var isSource = packageDef.architecture.indexOf ('source') !== -1;

    var scripts = [{
      script:  'postinst',
      sysRoot: './'
    }, {
      script:  'prerm',
      sysRoot: './'
    }];

    if (packageDef.architecture.indexOf ('source') >= 0) {
      scripts.push ({
        script:  pacmanConfig.pkgMakeall,
        sysRoot: '../../../'
      });
    }

    scripts.forEach (function (it) {
      copyTemplateFiles (packagePath, it.script, sharePath, it.sysRoot, isSource);
    });
  }

  createConfigJson (packageDef, sharePath);

  /* Build the package with wpkg. */
  var action = packageDef.architecture.indexOf ('source') === -1 ? 'build' : 'buildSrc';
  wpkg[action] (packagePath, packageDef.distribution, callback);
};

var processFile = function (files, packageDef, useStamps, callback) {
  var controlFile = files.shift ().control;

  xLog.info ('process ' + controlFile);

  var packagePath = path.resolve (path.dirname (controlFile), '..');

  /* Reserved directory for the post-installer. */
  var namespace = '';
  var name = packageDef.name;
  var fullName = packageDef.name.match (/(.*)\+(.*)/);
  if (fullName) {
    namespace = fullName[1];
    name      = fullName[2];
  }

  var sharePath = path.join (packagePath, 'usr/share', namespace, name);
  xFs.mkdir (sharePath);

  var productPath = path.join (xcraftConfig.pkgProductsRoot, packageDef.name);

  async.auto ({
    taskPrepeon: function (callback) {
      var prepeonPath = path.relative (__dirname, path.join (productPath, 'prepeon.js'));
      try {
        var prepeon = require (prepeonPath) (packagePath, sharePath, packageDef);
        prepeon.run (callback);
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
      build (packageDef, packagePath, sharePath, callback);
    }],
    taskPostpeon: ['taskPeon', function (callback) {
      var postpeonPath = path.relative (__dirname, path.join (productPath, 'postpeon.js'));
      try {
        var postpeon = require (postpeonPath) (packagePath, sharePath, packageDef);
        postpeon.run (callback);
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
    taskCopyPatches: function (callback) {
      var patchesIn  = path.join (productPath, 'patches');
      var patchesOut = path.join (sharePath,   'patches');

      if (fs.existsSync (patchesIn)) {
        xFs.cp (patchesIn, patchesOut);
      }

      callback ();
    },
    taskBuildPackage: ['taskPostpeon', 'taskCopyPatches', function (callback) {
      wpkgBuild (packageDef, packagePath, sharePath, function (err) {
        /* If no error we can refresh the stamp for this package. */
        if (useStamps && !err) {
          var stampsDir = path.join (xcraftConfig.xcraftRoot, pacmanConfig.stamps);
          var stampFile = path.join (stampsDir, packageDef.name + '.stamp');

          xFs.mkdir (stampsDir);
          fs.writeFileSync (stampFile, Date.now ());
        }

        callback (err);
      });
    }]
  }, function (err) {
    /* When we reach the last item, then we have done all async work. */
    if (!files.length) {
      callback (err);
    } else {
      processFile (files, packageDef, useStamps, callback);
    }
  });
};

/**
 * Make a package structure for WPKG.
 *
 * @param {string} packageName
 * @param {string} arch
 * @param {Object} defProps - List of overloaded properties with the values.
 * @param {function(err)} callback
 */
exports.package = function (packageName, arch, defProps, callback) {
  var control    = require ('./file/control.js');
  var changelog  = require ('./file/changelog.js');
  var copyright  = require ('./file/copyright.js');
  var cmakelists = require ('./file/cmakelists.js');
  var etc        = require ('./file/etc.js');
  var definition = require ('./def.js');

  var packageDef = null;
  try {
    packageDef = definition.load (packageName, defProps);
  } catch (ex) {
    callback (ex);
    return;
  }

  xLog.info ('Make %s package%s for %s.',
             packageName || 'all',
             packageName ? '' : 's',
             arch || 'all architectures');

  /* Check if the last `make` is more recent that the files (mtime) in the
   * packages/ directory. Note that if you have removed the packages in the
   * toolchain repository, you must delete the timestamp files too.
   */
  var stampsDir = path.join (xcraftConfig.xcraftRoot, pacmanConfig.stamps);
  var stampFile = path.join (stampsDir, packageDef.name + '.stamp');

  var useStamps = !defProps || !Object.keys (defProps).length;
  try {
    if (useStamps) {
      var stamp = fs.readFileSync (stampFile);

      var pkgDir = path.join (xcraftConfig.pkgProductsRoot, packageName);
      if (!xFs.newerFiles (pkgDir, null, new Date (parseInt (stamp)))) {
        xLog.info (' -> The package is already up to date');
        callback ();
        return;
      }
    } else {
      fs.unlinkSync (stampFile);
    }
  } catch (ex) {
    if (ex.code !== 'ENOENT') {
      throw ex;
    }
  }

  try {
    var controlFiles = control.controlFiles (arch, packageDef, true);
    busClient.events.send ('pacman.make.control', controlFiles);

    if (!controlFiles.length) {
      callback ();
      return;
    }

    changelog.changelogFiles (arch, packageDef);
    copyright.copyrightFiles (arch, packageDef);
    cmakelists.cmakelistsFile (arch, packageDef);
    etc.etcFiles (arch, packageDef);

    processFile (controlFiles, packageDef, useStamps, callback);
  } catch (err) {
    callback (err);
  }
};
