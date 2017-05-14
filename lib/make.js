'use strict';

const fs = require ('fs');
const path = require ('path');
const watt = require ('watt');

const utils = require ('./utils');

const xUri = require ('xcraft-core-uri');
const xFs = require ('xcraft-core-fs');
const xPlatform = require ('xcraft-core-platform');
const xPh = require ('xcraft-core-placeholder');
const xPeon = require ('xcraft-contrib-peon');

class Make {
  constructor (response) {
    this._response = response;

    const xEtc = require ('xcraft-core-etc') (null, response);
    this._xcraftConfig = xEtc.load ('xcraft');
    this._pacmanConfig = xEtc.load ('xcraft-contrib-pacman');
    this._wpkg = require ('xcraft-contrib-wpkg') (response);

    watt.wrapAll (this);
  }

  _copyTemplateFiles (def, packagePath, script, sharePath, sysRoot, isSource) {
    const action = script.replace (/\..*$/, '');
    const ext = isSource
      ? xPlatform.getShellExtArray ()
      : [xPlatform.getShellExt ()];

    ext.forEach (fileExt => {
      const scriptFileIn = path.join (
        path.join (__dirname, './templates/'),
        this._pacmanConfig.pkgScript + fileExt
      );
      const scriptFileOut = path.join (
        packagePath,
        !isSource ? this._pacmanConfig.pkgWPKG : '',
        script + fileExt
      );

      const ph = new xPh.Placeholder ();
      ph
        .set ('NAME', def.name)
        .set ('VERSION', def.version)
        .set (
          'SHARE',
          path.relative (packagePath, sharePath).replace (/\\/g, '\\\\')
        )
        .set ('HOOK', 'local')
        .set ('ACTION', action)
        .set ('SYSROOT', sysRoot.replace (/\\/g, '\\\\'))
        .set (
          'CONFIG',
          path.join (sysRoot, 'etc/peon.json').replace (/\\/g, '\\\\')
        )
        .injectFile ('PACMAN', scriptFileIn, scriptFileOut);

      /* chmod +x flag for Unix, ignored on Windows. */
      fs.chmodSync (scriptFileOut, 493 /* 0755 */);
    });
  }

  _createConfigJson (packageDef, postInstDir) {
    const config = packageDef.data;

    config.get.uri = xUri.realUri (config.get.uri, packageDef.name);

    const data = JSON.stringify (config, null, 2);
    const outFile = path.join (postInstDir, 'config.json');

    fs.writeFileSync (outFile, utils.injectThisPh (packageDef, data), 'utf8');
  }

  *_build (packageDef, packagePath, sharePath, next) {
    /* Are the resources embedded in the package (less than 1GB)? */
    if (!packageDef.data.embedded) {
      return;
    }

    const dataType = packageDef.data.type;
    const rulesType = packageDef.data.rules.type;
    const getObj = packageDef.data.get;

    getObj.uri = xUri.realUri (
      utils.injectThisPh (packageDef, packageDef.data.get.uri),
      packageDef.name
    );

    /* NOTE: even with the 'exec' rule, we prevent to pass the binary to
     *       execute because here we are not installing, but only packaging.
     */
    const extra = {
      configure: utils.injectThisPh (packageDef, packageDef.data.configure),
      location: utils.injectThisPh (packageDef, packageDef.data.rules.location),
      embedded: packageDef.data.embedded,
      onlyPackaging: true,
    };

    yield xPeon[dataType][rulesType] (
      getObj,
      packagePath,
      sharePath,
      extra,
      this._response,
      next
    );
  }

  *_wpkgBuild (packageDef, packagePath, sharePath, outputRepository, next) {
    /* Don't copy pre/post scripts with unsupported architectures. */
    if (packageDef.architecture.indexOf ('all') === -1) {
      const isSource = packageDef.architecture.indexOf ('source') !== -1;

      const scripts = [
        {
          script: 'postinst',
          sysRoot: './',
        },
        {
          script: 'prerm',
          sysRoot: './',
        },
      ];

      if (packageDef.architecture.indexOf ('source') >= 0) {
        scripts.push ({
          script: this._pacmanConfig.pkgMakeall,
          sysRoot: '../../../',
        });
      }

      scripts.forEach (it => {
        this._copyTemplateFiles (
          packageDef,
          packagePath,
          it.script,
          sharePath,
          it.sysRoot,
          isSource
        );
      });
    }

    this._createConfigJson (packageDef, sharePath);

    /* Build the package with wpkg. */
    const action = packageDef.architecture.indexOf ('source') === -1
      ? 'build'
      : 'buildSrc';
    yield this._wpkg[action] (
      packagePath,
      packageDef.distribution,
      outputRepository,
      next
    );
  }

  *_processFile (files, packageDef, useStamps, outputRepository, next) {
    const controlFile = files.shift ().control;

    this._response.log.info ('process ' + controlFile);

    const packagePath = path.resolve (path.dirname (controlFile), '..');

    /* Reserved directory for the post-installer. */
    let namespace = '';
    let name = packageDef.name;
    const fullName = packageDef.name.match (/(.*)\+(.*)/);
    if (fullName) {
      namespace = fullName[1];
      name = fullName[2];
    }

    const sharePath = path.join (packagePath, 'usr/share', namespace, name);
    xFs.mkdir (sharePath);

    const exceptions = [];
    const productPath = path.join (
      this._xcraftConfig.pkgProductsRoot,
      packageDef.name
    );

    try {
      /* 1. Prepeon */
      const prepeonPath = path.relative (
        __dirname,
        path.join (productPath, 'prepeon.js')
      );
      try {
        delete require.cache[require.resolve (prepeonPath)];
        const prepeon = require (prepeonPath) (
          packagePath,
          sharePath,
          packageDef,
          this._response
        );
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
      const postpeonPath = path.relative (
        __dirname,
        path.join (productPath, 'postpeon.js')
      );
      try {
        const postpeon = require (postpeonPath) (
          packagePath,
          sharePath,
          packageDef,
          this._response
        );
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
      const patchesIn = path.join (productPath, 'patches');
      const patchesOut = path.join (sharePath, 'patches');

      if (fs.existsSync (patchesIn)) {
        xFs.cp (patchesIn, patchesOut);
      }

      /* 5. Build package */
      yield this._wpkgBuild (
        packageDef,
        packagePath,
        sharePath,
        outputRepository,
        next
      );
      /* Refresh the stamp for this package. */
      if (useStamps) {
        const stampsDir = path.join (
          this._xcraftConfig.xcraftRoot,
          this._pacmanConfig.stamps
        );
        const stampFile = path.join (stampsDir, packageDef.name + '.stamp');

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
        this._processFile (
          files,
          packageDef,
          useStamps,
          outputRepository,
          next
        );
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
   */
  *package (packageName, arch, defProps, outputRepository) {
    const control = require ('./file/control.js');
    const changelog = require ('./file/changelog.js');
    const copyright = require ('./file/copyright.js');
    const cmakelists = require ('./file/cmakelists.js');
    const etc = require ('./file/etc.js');
    const definition = require ('./def.js');

    const packageDef = definition.load (packageName, defProps, this._response);

    this._response.log.info (
      'Make %s package%s for %s.',
      packageName || 'all',
      packageName ? '' : 's',
      arch || 'all architectures'
    );

    let useStamps = false;
    if (!outputRepository) {
      /* Check if the last `make` is more recent that the files (mtime) in the
       * packages/ directory. Note that if you have removed the packages in the
       * toolchain repository, you must delete the timestamp files too.
       */
      const stampsDir = path.join (
        this._xcraftConfig.xcraftRoot,
        this._pacmanConfig.stamps
      );
      const stampFile = path.join (stampsDir, packageDef.name + '.stamp');

      useStamps = !defProps || !Object.keys (defProps).length;
      try {
        if (useStamps) {
          const stamp = fs.readFileSync (stampFile);

          const pkgDir = path.join (
            this._xcraftConfig.pkgProductsRoot,
            packageName
          );
          if (!xFs.newerFiles (pkgDir, null, new Date (parseInt (stamp)))) {
            this._response.log.info (' -> The package is already up to date');
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

    const controlFiles = control.controlFiles (
      arch,
      packageDef,
      true,
      this._response
    );
    this._response.events.send ('pacman.make.control', controlFiles);

    if (!controlFiles.length) {
      return;
    }

    changelog.changelogFiles (arch, packageDef, this._response);
    copyright.copyrightFiles (arch, packageDef, this._response);
    cmakelists.cmakelistsFile (arch, packageDef, this._response);
    etc.etcFiles (arch, packageDef, this._response);

    yield this._processFile (
      controlFiles,
      packageDef,
      useStamps,
      outputRepository
    );
  }
}

module.exports = response => new Make (response);
