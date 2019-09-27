'use strict';

const fs = require('fs');
const path = require('path');
const watt = require('gigawatts');

const utils = require('./utils');

const xUri = require('xcraft-core-uri');
const xFs = require('xcraft-core-fs');
const xPlatform = require('xcraft-core-platform');
const xPh = require('xcraft-core-placeholder');
const xPeon = require('xcraft-contrib-peon');

class Make {
  constructor(resp) {
    this._resp = resp;

    const xEtc = require('xcraft-core-etc')(null, resp);
    this._xcraftConfig = xEtc.load('xcraft');
    this._pacmanConfig = xEtc.load('xcraft-contrib-pacman');
    this._wpkg = require('xcraft-contrib-wpkg')(resp);

    watt.wrapAll(this);
  }

  _copyTemplateFiles(def, packagePath, script, sharePath, sysRoot, isSource) {
    const action = script.replace(/\..*$/, '');
    const ext = isSource
      ? xPlatform.getShellExtArray()
      : [xPlatform.getShellExt()];

    ext.forEach(fileExt => {
      const scriptFileIn = path.join(
        path.join(__dirname, './templates/'),
        this._pacmanConfig.pkgScript + fileExt
      );
      const scriptFileOut = path.join(
        packagePath,
        !isSource ? this._pacmanConfig.pkgWPKG : '',
        script + fileExt
      );

      const ph = new xPh.Placeholder();
      ph.set('NAME', def.name)
        .set('VERSION', def.version)
        .set(
          'SHARE',
          path.relative(packagePath, sharePath).replace(/\\/g, '\\\\')
        )
        .set('HOOK', 'local')
        .set('ACTION', action)
        .set('SYSROOT', sysRoot.replace(/\\/g, '\\\\'))
        .injectFile('PACMAN', scriptFileIn, scriptFileOut);

      /* chmod +x flag for Unix, ignored on Windows. */
      fs.chmodSync(scriptFileOut, 493 /* 0755 */);
    });
  }

  _createConfigJson(packageDefs, distribution, postInstDir) {
    const packageDef = packageDefs[distribution];
    const config = packageDef.data;

    distribution = distribution === packageDefs._base ? '' : `.${distribution}`;
    config.get.uri = xUri.realUri(config.get.uri, packageDef.name);

    const data = JSON.stringify(config, null, 2);
    const outFile = path.join(
      postInstDir,
      `config${distribution.replace('/', '')}.json`
    );

    fs.writeFileSync(outFile, utils.injectThisPh(packageDef, data), 'utf8');
  }

  *_build(packageDef, packagePath, sharePath, next) {
    /* Are the resources embedded in the package (less than 2GB)? */
    if (!packageDef.data.embedded || packageDef._stub) {
      return;
    }

    const dataType = packageDef.data.type;
    const rulesType = packageDef.data.rules.type;
    const getObj = packageDef.data.get;

    getObj.uri = xUri.realUri(
      utils.injectThisPh(packageDef, packageDef.data.get.uri),
      packageDef.name
    );

    getObj.ref = utils.injectThisPh(packageDef, packageDef.data.get.ref);

    /* NOTE: even with the 'exec' rule, we prevent to pass the binary to
     *       execute because here we are not installing, but only packaging.
     */
    const extra = {
      configure: utils.injectThisPh(packageDef, packageDef.data.configure),
      location: utils.injectThisPh(packageDef, packageDef.data.rules.location),
      embedded: packageDef.data.embedded,
      onlyPackaging: true,
    };

    yield xPeon[dataType][rulesType](
      getObj,
      packagePath,
      sharePath,
      extra,
      this._resp,
      next
    );
  }

  *_wpkgBuild(
    packageDefs,
    distribution,
    packagePath,
    sharePath,
    outputRepository,
    next
  ) {
    const packageDef = packageDefs[distribution];
    const isSource = packageDef.architecture.indexOf('source') !== -1;

    /* Don't copy pre/post scripts with unsupported architectures. */
    if (packageDef.architecture.indexOf('all') === -1) {
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

      if (isSource) {
        scripts.push({
          script: this._pacmanConfig.pkgMakeall,
          sysRoot: '../../../',
        });
      }

      scripts.forEach(it => {
        this._copyTemplateFiles(
          packageDef,
          packagePath,
          it.script,
          sharePath,
          it.sysRoot,
          isSource
        );
      });
    }

    Object.keys(packageDefs)
      .filter(distribution => !/^_/.test(distribution))
      .forEach(distribution =>
        this._createConfigJson(packageDefs, distribution, sharePath)
      );

    /* Build the package with wpkg. */
    let action = 'build';
    if (isSource) {
      action = 'buildSrc';
      distribution = this._pacmanConfig.pkgToolchainRepository;
    }
    yield this._wpkg[action](packagePath, outputRepository, distribution, next);
  }

  *_processFile(
    files,
    packageDefs,
    distribution,
    useStamps,
    outputRepository,
    next
  ) {
    const packageDef = packageDefs[distribution];
    const controlFile = files.shift().control;
    const timestamp = Date.now();

    this._resp.log.info('process ' + controlFile);

    const packagePath = path.resolve(path.dirname(controlFile), '..');

    /* Reserved directory for the post-installer. */
    let namespace = '';
    let name = packageDef.name;
    const fullName = packageDef.name.match(/(.*)\+(.*)/);
    if (fullName) {
      namespace = fullName[1];
      name = fullName[2];
    }

    const sharePath = path.join(packagePath, 'usr/share', namespace, name);
    xFs.mkdir(sharePath);

    const exceptions = [];
    const productPath = path.join(
      this._xcraftConfig.pkgProductsRoot,
      packageDef.name
    );

    try {
      /* 1. Prepeon */
      const prepeonPath = path.relative(
        __dirname,
        path.join(productPath, 'prepeon.js')
      );
      try {
        delete require.cache[require.resolve(prepeonPath)];
        const prepeon = require(prepeonPath)(
          packagePath,
          sharePath,
          packageDef,
          this._resp
        );
        yield prepeon.run(next);
      } catch (ex) {
        /* FIXME: how to handle the case where an internal require fails? */
        if (ex.code === 'MODULE_NOT_FOUND') {
          this._resp.log.info('no prepeon script for this package');
        } else {
          this._resp.log.err(ex.stack || ex);
          throw ex;
        }
      }

      /* 2. Peon */
      yield this._build(packageDef, packagePath, sharePath, next);

      /* 3 Postpeon */
      const postpeonPath = path.relative(
        __dirname,
        path.join(productPath, 'postpeon.js')
      );
      try {
        delete require.cache[require.resolve(postpeonPath)];
        const postpeon = require(postpeonPath)(
          packagePath,
          sharePath,
          packageDef,
          this._resp
        );
        yield postpeon.run(next);
      } catch (ex) {
        /* FIXME: how to handle the case where an internal require fails? */
        if (ex.code === 'MODULE_NOT_FOUND') {
          this._resp.log.info('no postpeon script for this package');
        } else {
          this._resp.log.err(ex.stack || ex);
          throw ex;
        }
      }

      /* 4 Copy patches */
      const patchesIn = path.join(productPath, 'patches');
      const patchesOut = path.join(sharePath, 'patches');

      if (fs.existsSync(patchesIn)) {
        xFs.cp(patchesIn, patchesOut);
      }

      /* 5. Build package */
      yield this._wpkgBuild(
        packageDefs,
        distribution,
        packagePath,
        sharePath,
        outputRepository,
        next
      );
      /* Refresh the stamp for this package. */
      if (useStamps) {
        const stampsDir = path.join(
          this._xcraftConfig.xcraftRoot,
          this._pacmanConfig.stamps
        );
        const stampFile = path.join(stampsDir, packageDef.name + '.stamp');

        xFs.mkdir(stampsDir);
        fs.writeFileSync(stampFile, timestamp);
      }
    } catch (ex) {
      exceptions.push(ex);
    } finally {
      /* When we reach the last item, then we have done all async work. */
      if (!files.length) {
        if (exceptions.length) {
          /* eslint-disable-next-line no-unsafe-finally */
          throw exceptions;
        }
      } else {
        this._processFile(
          files,
          packageDefs,
          distribution,
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
  *package(packageName, arch, defProps, outputRepository) {
    const control = require('./file/control.js');
    const changelog = require('./file/changelog.js');
    const copyright = require('./file/copyright.js');
    const cmakelists = require('./file/cmakelists.js');
    const etc = require('./file/etc.js');
    const definition = require('./def.js');

    const packageDefs = definition.loadAll(packageName, defProps, this._resp);
    const distribution = packageDefs._base;
    const packageDef = packageDefs[distribution];

    this._resp.log.info(
      `Make ${packageName || 'all'} package${
        packageName ? '' : 's'
      } for ${arch || 'all architectures'}`
    );

    let useStamps = false;
    if (!outputRepository) {
      /* Check if the last `make` is more recent that the files (mtime) in the
       * packages/ directory. Note that if you have removed the packages in the
       * toolchain repository, you must delete the timestamp files too.
       */
      const stampsDir = path.join(
        this._xcraftConfig.xcraftRoot,
        this._pacmanConfig.stamps
      );
      const stampFile = path.join(stampsDir, packageDef.name + '.stamp');

      useStamps = !defProps || !Object.keys(defProps).length;
      try {
        if (useStamps) {
          const stamp = fs.readFileSync(stampFile);

          const pkgDir = path.join(
            this._xcraftConfig.pkgProductsRoot,
            packageName
          );
          if (!xFs.newerFiles(pkgDir, null, new Date(parseInt(stamp)))) {
            this._resp.log.info(' -> The package is already up to date');
            return;
          }
        } else {
          fs.unlinkSync(stampFile);
        }
      } catch (ex) {
        if (ex.code !== 'ENOENT') {
          throw ex;
        }
      }
    }

    const controlFiles = control.controlFiles(
      arch,
      packageDef,
      true,
      this._resp
    );
    this._resp.events.send('pacman.make.control', controlFiles);

    if (!controlFiles.length) {
      return;
    }

    changelog.changelogFiles(arch, packageDef, this._resp);
    copyright.copyrightFiles(arch, packageDef, this._resp);
    cmakelists.cmakelistsFile(arch, packageDef, this._resp);
    etc.etcFiles(arch, packageDef, this._resp);

    yield this._processFile(
      controlFiles,
      packageDefs,
      distribution,
      useStamps,
      outputRepository
    );
  }
}

module.exports = resp => new Make(resp);
