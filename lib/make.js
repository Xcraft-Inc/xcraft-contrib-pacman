'use strict';

var fs    = require ('fs');
var path  = require ('path');
const watt = require ('watt');

var utils = require ('./utils');

var xFs       = require ('xcraft-core-fs');
var xPlatform = require ('xcraft-core-platform');
var xPh       = require ('xcraft-core-placeholder');


class Make {
  constructor (response) {
    this._response = response;

    const xEtc = require ('xcraft-core-etc') (null, response);
    this._xcraftConfig = xEtc.load ('xcraft');
    this._pacmanConfig = xEtc.load ('xcraft-contrib-pacman');

    watt.wrapAll (this);
  }

  _copyTemplateFiles (def, packagePath, script, sharePath, sysRoot, isSource) {
    var action = script.replace (/\..*$/, '');
    var ext    = isSource ? xPlatform.getShellExtArray () : [xPlatform.getShellExt ()];

    ext.forEach ((fileExt) => {
      var scriptFileIn  = path.join (path.join (__dirname, './templates/'),
      this._pacmanConfig.pkgScript + fileExt);
      var scriptFileOut = path.join (packagePath, !isSource ? this._pacmanConfig.pkgWPKG : '',
      script + fileExt);

      var ph = new xPh.Placeholder ();
      ph.set ('NAME',    def.name)
        .set ('VERSION', def.version)
        .set ('SHARE',   path.relative (packagePath, sharePath))
        .set ('ACTION',  action)
        .set ('SYSROOT', sysRoot)
        .set ('CONFIG',  'etc/peon.json')
        .injectFile ('PACMAN', scriptFileIn, scriptFileOut);

      /* chmod +x flag for Unix, ignored on Windows. */
      fs.chmodSync (scriptFileOut, 493 /* 0755 */);
    });
  }

  _createConfigJson (packageDef, postInstDir) {
    var xUri = require ('xcraft-core-uri');

    var config = packageDef.data;

    config.get.uri = xUri.realUri (config.get.uri, packageDef.name);

    var data = JSON.stringify (config, null, 2);
    var outFile = path.join (postInstDir, 'config.json');

    fs.writeFileSync (outFile, utils.injectThisPh (packageDef, data), 'utf8');
  }

  _build (packageDef, packagePath, sharePath, callback) {
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

    xPeon[dataType][rulesType] (getObj, packagePath, sharePath, extra, this._response, callback);
  }

  _wpkgBuild (packageDef, packagePath, sharePath, outputRepository, callback) {
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
          script:  this._pacmanConfig.pkgMakeall,
          sysRoot: '../../../'
        });
      }

      scripts.forEach ((it) => {
        this._copyTemplateFiles (packageDef, packagePath, it.script, sharePath, it.sysRoot, isSource);
      });
    }

    this._createConfigJson (packageDef, sharePath);

    /* Build the package with wpkg. */
    var action = packageDef.architecture.indexOf ('source') === -1 ? 'build' : 'buildSrc';
    wpkg[action] (packagePath, packageDef.distribution, outputRepository, this._response, callback);
  }

  * _processFile (files, packageDef, useStamps, outputRepository, next) {
    var controlFile = files.shift ().control;

    this._response.log.info ('process ' + controlFile);

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

    const exceptions = [];
    var productPath = path.join (this._xcraftConfig.pkgProductsRoot, packageDef.name);

    try {
      /* 1. Prepeon */
      var prepeonPath = path.relative (__dirname, path.join (productPath, 'prepeon.js'));
      try {
        delete require.cache[require.resolve (prepeonPath)];
        var prepeon = require (prepeonPath) (packagePath, sharePath, packageDef, this._response);
        yield prepeon.run (next);
      } catch (ex) {
        /* FIXME: how to handle the case where an internal require fails? */
        if (ex.code === 'MODULE_NOT_FOUND') {
          this._response.log.info ('no prepeon script for this package');
        } else {
          this._response.log.err (ex.stack || ex);
          throw ex;
        }
      }

      /* 2. Peon */
      yield this._build (packageDef, packagePath, sharePath, next);

      /* 3 Postpeon */
      var postpeonPath = path.relative (__dirname, path.join (productPath, 'postpeon.js'));
      try {
        var postpeon = require (postpeonPath) (packagePath, sharePath, packageDef, this._response);
        yield postpeon.run (next);
      } catch (ex) {
        /* FIXME: how to handle the case where an internal require fails? */
        if (ex.code === 'MODULE_NOT_FOUND') {
          this._response.log.info ('no postpeon script for this package');
        } else {
          this._response.log.err (ex.stack || ex);
          throw ex;
        }
      }

      /* 4 Copy patches */
      var patchesIn  = path.join (productPath, 'patches');
      var patchesOut = path.join (sharePath,   'patches');

      if (fs.existsSync (patchesIn)) {
        xFs.cp (patchesIn, patchesOut);
      }

      /* 5. Build package */
      yield this._wpkgBuild (packageDef, packagePath, sharePath, outputRepository, next);
      /* Refresh the stamp for this package. */
      if (useStamps) {
        var stampsDir = path.join (this._xcraftConfig.xcraftRoot, this._pacmanConfig.stamps);
        var stampFile = path.join (stampsDir, packageDef.name + '.stamp');

        xFs.mkdir (stampsDir);
        fs.writeFileSync (stampFile, Date.now ());
      }
    } catch (ex) {
      exceptions.push (ex);
    } finally {
      /* When we reach the last item, then we have done all async work. */
      if (!files.length) {
        if (exceptions.length) {
          throw exceptions;
        }
      } else {
        this._processFile (files, packageDef, useStamps, outputRepository, next);
      }
    }
  }

  /**
   * Make a package structure for WPKG.
   *
   * @param {string} packageName
   * @param {string} arch
   * @param {Object} defProps - List of overloaded properties with the values.
   * @param {string} outputRepository - null for default.
   * @param {function(err)} callback
   */
  package (packageName, arch, defProps, outputRepository, callback) {
    var control    = require ('./file/control.js');
    var changelog  = require ('./file/changelog.js');
    var copyright  = require ('./file/copyright.js');
    var cmakelists = require ('./file/cmakelists.js');
    var etc        = require ('./file/etc.js');
    var definition = require ('./def.js');

    var packageDef = null;
    try {
      packageDef = definition.load (packageName, defProps, this._response);
    } catch (ex) {
      callback (ex);
      return;
    }

    this._response.log.info ('Make %s package%s for %s.',
                             packageName || 'all',
                             packageName ? '' : 's',
                             arch || 'all architectures');

    let useStamps = false;
    if (!outputRepository) {
      /* Check if the last `make` is more recent that the files (mtime) in the
       * packages/ directory. Note that if you have removed the packages in the
       * toolchain repository, you must delete the timestamp files too.
       */
      var stampsDir = path.join (this._xcraftConfig.xcraftRoot, this._pacmanConfig.stamps);
      var stampFile = path.join (stampsDir, packageDef.name + '.stamp');

      useStamps = !defProps || !Object.keys (defProps).length;
      try {
        if (useStamps) {
          var stamp = fs.readFileSync (stampFile);

          var pkgDir = path.join (this._xcraftConfig.pkgProductsRoot, packageName);
          if (!xFs.newerFiles (pkgDir, null, new Date (parseInt (stamp)))) {
            this._response.log.info (' -> The package is already up to date');
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
    }

    try {
      var controlFiles = control.controlFiles (arch, packageDef, true, this._response);
      this._response.events.send ('pacman.make.control', controlFiles);

      if (!controlFiles.length) {
        callback ();
        return;
      }

      changelog.changelogFiles (arch, packageDef, this._response);
      copyright.copyrightFiles (arch, packageDef, this._response);
      cmakelists.cmakelistsFile (arch, packageDef, this._response);
      etc.etcFiles (arch, packageDef, this._response);

      this._processFile (controlFiles, packageDef, useStamps, outputRepository, callback);
    } catch (err) {
      callback (err);
    }
  }
}

module.exports = (response) => new Make (response);
