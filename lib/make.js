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
const xPeonUtils = require('xcraft-contrib-peon/lib/utils.js');

class Make {
  constructor(resp) {
    this._resp = resp;

    const xEtc = require('xcraft-core-etc')(null, resp);
    this._xcraftConfig = xEtc.load('xcraft');
    this._pacmanConfig = xEtc.load('xcraft-contrib-pacman');
    this._wpkg = require('xcraft-contrib-wpkg')(resp);
    this._publish = require('./publish.js')(resp);
    this._def = require('./def.js');

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

  static makeGetObj(packageDef) {
    const getObj = packageDef.data.get;

    getObj.uri = xUri.realUri(
      utils.injectThisPh(packageDef, packageDef.data.get.uri),
      packageDef.name
    );

    getObj.ref = utils.injectThisPh(packageDef, packageDef.data.get.ref);
    return getObj;
  }

  *_build(packageDef, packagePath, sharePath, next) {
    /* Are the resources embedded in the package (less than 2GB)? */
    if (!packageDef.data.embedded || packageDef._stub) {
      return;
    }

    const dataType = packageDef.data.type;
    const rulesType = packageDef.data.rules.type;
    const getObj = Make.makeGetObj(packageDef);

    /* NOTE: even with the 'exec' rule, we prevent to pass the binary to
     *       execute because here we are not installing, but only packaging.
     */
    const extra = {
      configure: utils.injectThisPh(packageDef, packageDef.data.configure),
      location: utils.injectThisPh(packageDef, packageDef.data.rules.location),
      embedded: packageDef.data.embedded,
      onlyPackaging: true,
    };

    return yield xPeon[dataType][rulesType](
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

  *_processFile(files, packageDefs, distribution, outputRepository, next) {
    const packageDef = packageDefs[distribution];
    const controlFile = files.shift().control;
    let ref = null;

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
      ref = yield this._build(packageDef, packagePath, sharePath, next);

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
        this._resp.log.warn(`check for correct support of multi-control files`);
        // FIXME: what to do with the ref?
        this._processFile(
          files,
          packageDefs,
          distribution,
          outputRepository,
          next
        );
      }
    }

    return ref;
  }

  _bumpIfNecessary(packageName, version) {
    const packageDef = this._def.load(packageName, {}, this._resp, null);
    if (packageDef.version !== version) {
      return;
    }

    /* The package already exists then bump the package version */
    let newVersion = version;
    if (/-[0-9]+$/.test(version)) {
      newVersion = newVersion.replace(
        /-([0-9]$)/,
        (_, ver) => `-${parseInt(ver) + 1}`
      );
    } else {
      newVersion += '-1';
    }

    this._resp.log.info(
      `Bump the ${packageName} version from ${version} to ${newVersion}`
    );
    this._def.update(packageName, {version: newVersion}, this._resp, null);
  }

  _injectRef(packageName, ref) {
    const packageDef = this._def.load(packageName, {}, this._resp, null);
    if (!packageDef.data || !packageDef.data.get) {
      return;
    }

    this._resp.log.info(
      `Refresh the ${packageName} reference from ${packageDef.data.get._ref ||
        'n/a'} to ${ref}`
    );
    this._def.update(packageName, {'data.get._ref': ref}, this._resp, null);
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

    let packageDefs;
    let distribution;
    let packageDef;

    const loadDefs = () => {
      packageDefs = this._def.loadAll(packageName, defProps, this._resp);
      distribution = packageDefs._base;
      packageDef = packageDefs[distribution];
    };

    loadDefs();

    this._resp.log.info(
      `Make ${packageName || 'all'} package${
        packageName ? '' : 's'
      } for ${arch || 'all architectures'}`
    );

    let stamp = null;
    const stampsDir = path.join(
      this._xcraftConfig.xcraftRoot,
      this._pacmanConfig.stamps
    );
    const stampFile = path.join(stampsDir, packageDef.name + '.stamp');
    const pkgDir = path.join(this._xcraftConfig.pkgProductsRoot, packageName);

    if (!outputRepository) {
      /* Check if the last `make` is more recent that the files (mtime) in the
       * packages/ directory. Note that if you have removed the packages in the
       * toolchain repository, you must delete the timestamp files too.
       */
      const readStamp = !defProps || !Object.keys(defProps).length;
      try {
        if (readStamp) {
          stamp = fs.readFileSync(stampFile).toString();

          const sum = xFs.shasum(pkgDir, null);
          if (sum === stamp) {
            this._resp.log.info(' -> The package is already up to date');
            return;
          }

          stamp = sum;
        } else {
          fs.unlinkSync(stampFile);
        }
      } catch (ex) {
        if (ex.code !== 'ENOENT') {
          throw ex;
        }
      }
    }

    let suffix = '';
    if (packageDef.architecture.indexOf('source') !== -1) {
      suffix = '-src';
    }
    const deb = yield this._publish.status(packageName + suffix, null, null);
    if (deb) {
      this._bumpIfNecessary(packageName, deb.version);
      loadDefs();
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

    const ref = yield this._processFile(
      controlFiles,
      packageDefs,
      distribution,
      outputRepository
    );

    if (ref) {
      this._injectRef(packageName, ref);
      stamp = xFs.shasum(pkgDir, null);
    }

    /* Refresh the stamp for this package. */
    if (stamp) {
      xFs.mkdir(stampsDir);
      fs.writeFileSync(stampFile, stamp);
    }
  }
}

module.exports = resp => new Make(resp);
