'use strict';

const fse = require('fs-extra');
const path = require('path');
const watt = require('gigawatts');

const utils = require('./utils');

const xUri = require('xcraft-core-uri');
const xFs = require('xcraft-core-fs');
const xPlatform = require('xcraft-core-platform');
const xPh = require('xcraft-core-placeholder');
const xUtils = require('xcraft-core-utils');
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
    const xPeon = require('xcraft-contrib-peon');
    const xEnv = require('xcraft-core-env');

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
      name: packageDef.name,
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

    if (distribution.indexOf('+') === -1) {
      Object.keys(packageDefs)
        .filter(
          (distribution) =>
            !/^_/.test(distribution) && !/[+]/.test(distribution)
        )
        .forEach((distribution) =>
          this._createConfigJson(packageDefs, distribution, sharePath)
        );
    } else {
      this._createConfigJson(packageDefs, distribution, sharePath);
    }

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
      if (res) {
        ref = res.ref;
        hash = res.hash;
      }

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
      let _ex = ex;
      if (typeof ex === 'string') {
        _ex = new Error(`${packageDef.name} ${ex}`);
      }
      exceptions.push(_ex);
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

  *_bumpIfNecessary(packageName, distribution) {
    const packageDef = this._def.load(
      packageName,
      {},
      this._resp,
      distribution
    );
    const version = packageDef.version;
    const newVersion = yield this._publish.getNewVersionIfArchived(
      packageName,
      version,
      distribution
    );

    if (newVersion === version) {
      return false;
    }

    /* The package already exists then bump the package version */
    this._resp.log.info(
      `Bump the ${packageName} version from ${version} to ${newVersion}`
    );
    this._def.update(
      packageName,
      {version: newVersion},
      this._resp,
      distribution
    );
    return true;
  }

  _injectRef(packageName, ref, distribution = null) {
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
    this._def.update(
      packageName,
      {'data.get.$ref': ref},
      this._resp,
      distribution
    );
  }

  injectHash(packageName, hash, distribution = null) {
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
    this._def.update(
      packageName,
      {'data.get.$hash': hash},
      this._resp,
      distribution
    );
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

  _migrateOldStamps(packageDef, newStampFile) {
    const oldStampsDir = path.join(
      this._xcraftConfig.xcraftRoot,
      this._pacmanConfig.stamps
    );
    const oldStampFile = path.join(oldStampsDir, packageDef.name + '.stamp');
    if (!fse.existsSync(oldStampFile)) {
      return;
    }

    if (fse.existsSync(newStampFile)) {
      fse.removeSync(oldStampFile);
      return;
    }

    fse.copyFileSync(oldStampFile, newStampFile);
    fse.removeSync(oldStampFile);
  }

  _getStampRegex(distribution) {
    const isSpecificDistrib = distribution && distribution.indexOf('+') !== -1;
    return isSpecificDistrib
      ? new RegExp(
          `^([.].*|config[.](?!${distribution
            .replace(/[+]/g, '[+]')
            .replace('/', '')}).*[.]yaml)$`
        )
      : /^[.].*|^config[.].*[+].*[.]yaml$/;
  }

  _computeStampSums(packageDir, distribution) {
    const regex = this._getStampRegex(distribution);

    const payload = xFs
      .shasum(
        packageDir,
        (item) => !regex.test(item),
        (item, data) =>
          item.endsWith('.yaml')
            ? /* Ignore $ref entry of YAML files */
              Buffer.from(data.toString().replace(/\$ref: [^ ]+/, `$ref: ''`))
            : data
      )
      .trim();
    const listing = xUtils.crypto.sha256(
      xFs
        .lsall(packageDir, false, (item) => !regex.test(item))
        .map((entry) => path.relative(packageDir, entry))
        .join(':')
    );
    return [payload, listing];
  }

  *_checkVersion(
    packageName,
    distribution,
    defVersion,
    debVersion,
    defGreaterThatDeb
  ) {
    if (debVersion && !defGreaterThatDeb) {
      /* This is not possible because the sync stuff for the repositories keep
       * only the greater versions of each package. When an older version is maked,
       * this one is stripped out the repository.
       * Note that downgrade is not easy and it must be done with care.
       */
      throw new Error(
        `You cannot make the package ${packageName} with a lower version ` +
          `(${defVersion}) that the already published package (${debVersion}). ` +
          `If it's what you want, you must remove and unpublish the packages.`
      );
    }

    const latestVersion = this._wpkg.getArchiveLatestVersion(
      packageName,
      distribution
    );
    if (!latestVersion) {
      return;
    }

    const isLatestGreater = yield this._wpkg.isV1Greater(
      latestVersion, // V1
      defVersion // V2
    );

    if (isLatestGreater) {
      this._resp.log.warn(
        `You try to make the package ${packageName} with a lower version (${defVersion}) ` +
          `that the last archived package ${latestVersion}. ` +
          `Of course, you can do that but are you sure that it is really what you want?`
      );
    } else if (latestVersion === defVersion) {
      this._resp.log.info(
        `The package ${packageName} is already published and up to date`
      );
    }
  }

  /**
   * Make a package structure for WPKG.
   *
   * @yields
   * @param {string} packageName - Main package.
   * @param {string} arch - Architecture.
   * @param {object} defProps - List of overloaded properties with the values.
   * @param {string} outputRepository - null for default.
   * @param {string} [distribution] - One explicit distribution.
   * @returns {*} packages to bump (and prevents useless bumps)
   */
  *package(packageName, arch, defProps, outputRepository, distribution) {
    const control = require('./file/control.js');
    const changelog = require('./file/changelog.js');
    const copyright = require('./file/copyright.js');
    const cmakelists = require('./file/cmakelists.js');
    const etc = require('./file/etc.js');

    let packageDefs;
    let packageDef;
    let result = {bump: [], make: false};

    const loadDefs = () => {
      packageDefs = this._def.loadAll(packageName, defProps, this._resp);
      if (!distribution || (distribution && !packageDefs[distribution])) {
        distribution = packageDefs._base;
      }
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

    const isSpecificDistrib = distribution && distribution.indexOf('+') !== -1;
    const baseDistrib = this._pacmanConfig.pkgToolchainRepository;
    const stampDistrib = isSpecificDistrib ? distribution : baseDistrib;

    const stampsDir = path.join(
      this._wpkg.getArchivesPath(
        path.join(this._xcraftConfig.xcraftRoot, 'var/_'),
        stampDistrib
      ),
      packageDef.name
    );
    const stampFile = () => path.join(stampsDir, packageDef.version + '.stamp');
    const pkgDir = path.join(this._xcraftConfig.pkgProductsRoot, packageName);
    let skip = false;
    let bump = false;

    let stamp = null;
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
            /* XXX: migration for deprecated stamp files */
            this._migrateOldStamps(packageDef, stampFile());

            stamp = fse.readFileSync(stampFile()).toString().trim().split('@');
            const sums = this._computeStampSums(pkgDir, stampDistrib);

            /* New stamp format */
            if (stamp.length > 1) {
              skip = sums[0] === stamp[0] && sums[1] === stamp[1];
            } else {
              skip = sums[0] === stamp[0];
            }

            if (skip) {
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

            stamp = sums;
          }
        } catch (ex) {
          if (ex.code !== 'ENOENT') {
            throw ex;
          }
        }
      }

      yield this._admindir.create(`${packageName}:${arch}`, null, null);

      let suffix = '';
      const isSrc = packageDef.architecture.indexOf('source') !== -1;
      if (isSrc) {
        suffix = '-src';
      }

      let deb =
        isSrc && isSpecificDistrib
          ? false /* in this case, we must look at the archived repositories */
          : yield this._publish.status(
              packageName + suffix,
              distribution,
              null
            );

      let publishedDebVersion;
      let defGreaterThatDeb = false;
      if (deb && packageDef.version !== deb.version) {
        publishedDebVersion = deb.version;
        defGreaterThatDeb = yield this._wpkg.isV1Greater(
          packageDef.version,
          deb.version
        );
      }

      if (skip && (!deb || defGreaterThatDeb)) {
        /* Check if this package is not already built into the archived repositories
         * Copy the package in order to satisfy the main repository
         */
        for (const arch of packageDef.architecture) {
          try {
            deb = false;
            yield this._wpkg.copyFromArchiving(
              packageName + suffix,
              arch,
              packageDef.version,
              distribution
            );
            deb = yield this._publish.status(
              packageName + suffix,
              distribution,
              null
            );
          } catch (ex) {
            if (ex.code !== 'ENOENT') {
              throw ex;
            }
          }
        }
      }

      yield this._checkVersion(
        packageName + suffix,
        distribution,
        packageDef.version,
        publishedDebVersion,
        defGreaterThatDeb
      );

      if (skip && deb) {
        this._resp.log.info(`Nothing new to make for ${packageName}`);
        return result;
      }

      bump = yield this._bumpIfNecessary(packageName, distribution);
      if (bump) {
        /* Retry with the new version; maybe this version is already archived... */
        this._resp.log.info(
          `Make again because the package ${packageName} has been bumped`
        );
        return yield this.package(...arguments);
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
      return result;
    }

    changelog.changelogFiles(arch, packageDef, distribution, this._resp);
    copyright.copyrightFiles(arch, packageDef, this._resp);
    cmakelists.cmakelistsFile(arch, packageDef, this._resp);
    etc.etcFiles(arch, packageDef, this._resp);

    const {ref, hash} = yield this._processFile(
      controlFiles,
      packageDefs,
      distribution,
      outputRepository
    );

    result.make = true;

    if (!isStub) {
      /* Look for packages which must be re-"make" too */
      result.bump = packageDef.bump;

      if (ref) {
        this._injectRef(packageName, ref, distribution);
      }
      if (hash) {
        this.injectHash(packageName, hash, distribution);
      }
      if (ref || hash || bump || !stamp) {
        stamp = this._computeStampSums(pkgDir, stampDistrib);
      }

      /* Refresh the stamp for this package. */
      xFs.mkdir(stampsDir);
      fse.writeFileSync(stampFile(), stamp.join('@'));
    }

    return result;
  }
}

module.exports = (resp) => new Make(resp);
