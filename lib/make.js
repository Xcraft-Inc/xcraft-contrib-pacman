'use strict';

const fse = require('fs-extra');
const path = require('path');
const watt = require('gigawatts');

const utils = require('./utils');

const xUri = require('xcraft-core-uri');
const xFs = require('xcraft-core-fs');
const xPlatform = require('xcraft-core-platform');
const xPh = require('xcraft-core-placeholder');
const xPeon = require('xcraft-contrib-peon');
const xEnv = require('xcraft-core-env');
const xPeonUtils = require('xcraft-contrib-peon/lib/utils.js');

class Make {
  constructor(resp) {
    this._resp = resp;

    const xEtc = require('xcraft-core-etc')(null, resp);
    this._xcraftConfig = xEtc.load('xcraft');
    this._pacmanConfig = xEtc.load('xcraft-contrib-pacman');
    this._wpkg = require('xcraft-contrib-wpkg')(resp);
    this._publish = require('./publish.js')(resp);
    this._install = require('./install.js')(resp);
    this._admindir = require('./admindir.js')(resp);
    this._def = require('./def.js');

    watt.wrapAll(this);
  }

  _copyTemplateFiles(def, packagePath, script, sharePath, sysRoot, isSource) {
    const action = script.replace(/\..*$/, '');
    const ext = isSource
      ? xPlatform.getShellExtArray()
      : [xPlatform.getShellExt()];

    ext.forEach((fileExt) => {
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
      fse.chmodSync(scriptFileOut, 493 /* 0755 */);
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

    fse.writeFileSync(outFile, utils.injectThisPh(packageDef, data), 'utf8');
  }

  *_build(packageDef, packagePath, sharePath, next) {
    /* Are the resources embedded in the package (less than 2GB)? */
    if (!packageDef.data.embedded || packageDef._stub) {
      return;
    }

    const dataType = packageDef.data.type;
    const rulesType = packageDef.data.rules.type;
    const getObj = utils.makeGetObj(packageDef);

    /* NOTE: even with the 'exec' rule, we prevent to pass the binary to
     *       execute because here we are not installing, but only packaging.
     */
    const extra = {
      configure: utils.injectThisPh(packageDef, packageDef.data.configure),
      location: utils.injectThisPh(packageDef, packageDef.data.rules.location),
      embedded: packageDef.data.embedded,
      onlyPackaging: true,
      env: xEnv.pp(packageDef.data.rules.env),
    };

    if (packageDef.data.get.prepare) {
      extra.prepare = utils.injectThisPh(
        packageDef,
        packageDef.data.get.prepare
      );
    }

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

      scripts.forEach((it) => {
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
      .filter((distribution) => !/^_/.test(distribution))
      .forEach((distribution) =>
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
    let hash = null;

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
      /* 1. Peon */
      const res = yield this._build(packageDef, packagePath, sharePath, next);
      ref = res.ref;
      hash = res.hash;

      /* 2. Copy patches */
      const patchesIn = path.join(productPath, 'patches');
      const patchesOut = path.join(sharePath, 'patches');

      if (fse.existsSync(patchesIn)) {
        xFs.cp(patchesIn, patchesOut);
      }

      /* 3. Build package */
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

    return {ref, hash};
  }

  _bumpIfNecessary(packageName, version) {
    const packageDef = this._def.load(packageName, {}, this._resp, null);
    if (packageDef.version !== version) {
      return false;
    }

    /* The package already exists then bump the package version */
    let newVersion = version;
    if (/-[0-9]+$/.test(version)) {
      newVersion = newVersion.replace(
        /-([0-9]+$)/,
        (_, ver) => `-${parseInt(ver) + 1}`
      );
    } else {
      newVersion += '-1';
    }

    this._resp.log.info(
      `Bump the ${packageName} version from ${version} to ${newVersion}`
    );
    this._def.update(packageName, {version: newVersion}, this._resp, null);
    return true;
  }

  _injectRef(packageName, ref) {
    const packageDef = this._def.load(packageName, {}, this._resp, null);
    if (!packageDef.data || !packageDef.data.get) {
      return;
    }

    if (packageDef.data.get.$ref === ref) {
      return;
    }

    this._resp.log.info(
      `Refresh the ${packageName} reference from ${
        packageDef.data.get.$ref || 'n/a'
      } to ${ref}`
    );
    this._def.update(packageName, {'data.get.$ref': ref}, this._resp, null);
  }

  _injectHash(packageName, hash) {
    const packageDef = this._def.load(packageName, {}, this._resp, null);
    if (!packageDef.data || !packageDef.data.get) {
      return;
    }

    if (packageDef.data.get.$hash === hash) {
      return;
    }

    this._resp.log.info(
      `Refresh the ${packageName} shasum from ${
        packageDef.data.get.$hash || 'n/a'
      } to ${hash}`
    );
    this._def.update(packageName, {'data.get.$hash': hash}, this._resp, null);
  }

  static _makeList(makeDeps, arch) {
    return Object.keys(makeDeps).filter((name) =>
      makeDeps[name].some(
        (dep) =>
          !dep.architecture ||
          !dep.architecture.length ||
          dep.architecture.includes(arch)
      )
    );
  }

  /**
   * Get all make dependencies.
   *
   * @param {string} packageDef - Package definition.
   * @param {string} arch - Architecture.
   * @returns {string[]} the list of build packages.
   */
  _getMakeDeps(packageDef, arch) {
    return Make._makeList(packageDef.dependency.make, arch);
  }

  *_deployMakeDep(dep, next) {
    const fullpac = require('./fullpac.js');

    const packageDef = this._def.load(dep, {}, this._resp, null);

    const pkgPublished = yield this._publish.status(dep, null, null);
    if (pkgPublished && pkgPublished.version === packageDef.version) {
      /* FIXME: check against versions */
      const pkgInstalled = yield this._install.status(dep, null);
      if (pkgInstalled.installed) {
        return; /* The depedency is already available, then we can continue */
      }

      /* The dependency exists, build and install this package. */
      const cmdMsg = {
        packageRefs: dep,
        _ignoreOverwatch: true,
      };

      let result = yield this._resp.command.send('pacman.build', cmdMsg, next);
      if (result.data === this._resp.events.status.failed) {
        throw 'the command has failed';
      }

      result = yield this._resp.command.send('pacman.install', cmdMsg, next);
      if (result.data === this._resp.events.status.failed) {
        throw 'the command has failed';
      }
      return;
    }

    /* Full magic steps: make, build, install */
    yield fullpac(this._resp, dep, true);
  }

  /**
   * Make a package structure for WPKG.
   *
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
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

    /* Check if there are 'make' dependencies and if it's the case
     * then make, build and install where necessary.
     */
    const errors = [];
    for (const dep of this._getMakeDeps(packageDef, arch)) {
      try {
        yield this._deployMakeDep(dep);
      } catch (ex) {
        errors.push(ex);
      }
    }
    if (errors.length) {
      throw errors;
    }

    this._resp.log.info(
      `Make ${packageName || 'all'} package${packageName ? '' : 's'} for ${
        arch || 'all architectures'
      }`
    );

    let stamp = null;
    const stampsDir = path.join(
      this._xcraftConfig.xcraftRoot,
      this._pacmanConfig.stamps
    );
    const stampFile = path.join(stampsDir, packageDef.name + '.stamp');
    const pkgDir = path.join(this._xcraftConfig.pkgProductsRoot, packageName);
    let skip = false;
    let bump = false;

    /* Case where xcraft+stub is used for creating new stub packages
     * with pacman.build. The package name is overloaded.
     */
    const isStub = packageName !== packageDef.name;
    if (!isStub) {
      if (!outputRepository) {
        /* Check if the last `make` is more recent that the files (SHA) in the
         * packages/ directory. Note that if you have removed the packages in the
         * toolchain repository, you must delete the timestamp files too.
         */
        const readStamp = !defProps || !Object.keys(defProps).length;
        try {
          if (readStamp) {
            stamp = fse.readFileSync(stampFile).toString();

            const sum = xFs.shasum(pkgDir, /^[^.]/);
            if (sum === stamp) {
              skip = true;

              /* Check if the remote has changed (like master for a git repository) */
              const getObj = utils.makeGetObj(packageDef);
              const type = xPeonUtils.typeFromUri(getObj);

              if (type === 'git' && getObj.ref !== getObj.$ref) {
                const uri = xPeonUtils.cleanUri(getObj);
                const xScm = require('xcraft-core-scm');
                let ref = null;
                if (getObj.ref) {
                  ref = yield xScm.git.remoteRef(
                    uri,
                    `${getObj.ref}^{}` /* ref pointed by an annotated tag? */,
                    this._resp
                  );
                }
                if (!ref) {
                  ref = yield xScm.git.remoteRef(
                    uri,
                    getObj.ref || 'master' /* branch or lightweight tag? */,
                    this._resp
                  );
                }
                skip = ref === getObj.$ref;
              }
            }

            stamp = sum;
          } else {
            fse.removeSync(stampFile);
          }
        } catch (ex) {
          if (ex.code !== 'ENOENT') {
            throw ex;
          }
        }
      }

      yield this._admindir.create(`${packageName}:${arch}`, null, null);

      let suffix = '';
      if (packageDef.architecture.indexOf('source') !== -1) {
        suffix = '-src';
      }

      const deb = yield this._publish.status(packageName + suffix, null, null);
      if (deb) {
        if (skip) {
          this._resp.log.info(
            ' -> The package is already published and up to date'
          );
          return;
        }

        bump = this._bumpIfNecessary(packageName, deb.version);
        if (bump) {
          loadDefs();
        }
      }
    } else {
      this._resp.log.warn(
        `pacman is making a stub package for ${packageDef.name}`
      );
    }

    const controlFiles = control.controlFiles(
      arch,
      packageDef,
      true,
      this._resp
    );

    if (!controlFiles.length) {
      return;
    }

    changelog.changelogFiles(arch, packageDef, this._resp);
    copyright.copyrightFiles(arch, packageDef, this._resp);
    cmakelists.cmakelistsFile(arch, packageDef, this._resp);
    etc.etcFiles(arch, packageDef, this._resp);

    const {ref, hash} = yield this._processFile(
      controlFiles,
      packageDefs,
      distribution,
      outputRepository
    );

    if (!isStub) {
      if (ref) {
        this._injectRef(packageName, ref);
      }
      if (hash) {
        this._injectHash(packageName, hash);
      }
      if (ref || bump || !stamp) {
        stamp = xFs.shasum(pkgDir, /^[^.]/);
      }

      /* Refresh the stamp for this package. */
      xFs.mkdir(stampsDir);
      fse.writeFileSync(stampFile, stamp);
    }
  }
}

module.exports = (resp) => new Make(resp);
