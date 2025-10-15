/* eslint-disable no-prototype-builtins */
'use strict';

var path = require('path');
var _ = require('lodash');
const colors = require('picocolors').createColors(true);
const fse = require('fs-extra');

const watt = require('gigawatts');
var definition = require('./lib/def.js');
var list = require('./lib/list.js');
var utils = require('./lib/utils.js');

var xUtils = require('xcraft-core-utils');
var xEnv = require('xcraft-core-env');
const xWizard = require('xcraft-core-wizard');
const xPlatform = require('xcraft-core-platform');
const debversion = require('wpkg-debversion');

var cmd = {};

var depsPattern = '@deps';
var extractPackages = function (
  packageRefs,
  distribution,
  resp,
  withMake = false,
  _pkgs = []
) {
  var results = [];
  var pkgs = [];
  const arch = xPlatform.getToolchainArch();

  if (packageRefs) {
    packageRefs = packageRefs
      .replace(/,{2,}/g, ',')
      .replace(/^,/, '')
      .replace(/,$/, '');
  }

  var all = !packageRefs || !packageRefs.length;
  if (all) {
    pkgs = list.listProducts();

    pkgs.forEach(function (item) {
      results.push(item.Name);
    });
  } else {
    pkgs = packageRefs.split(',');

    var prev = null;
    pkgs.forEach(function (item) {
      if (!new RegExp(xUtils.regex.toRegexp(depsPattern)).test(item)) {
        /* When null, use the distribution specified in the first package. */
        if (!distribution) {
          const def = definition.load(item, null, resp, null);
          distribution = def.distribution;
        }

        prev = item;
        results = _.union(results, [item]);
        return;
      }

      /* Ignore the deps pattern if it's the first entry. */
      if (!prev) {
        return;
      }

      if (_pkgs[prev]) {
        prev = null;
        return;
      }

      /* Section to extract all dependencies for the current package. */
      var def = null;
      var deps = {};
      try {
        def = definition.load(prev, null, resp, distribution);
        _pkgs[prev] = true;
      } catch (ex) {
        prev = null;
        return;
      }

      Object.keys(def.dependency)
        .filter((type) => (withMake ? true : type !== 'make'))
        .forEach(function (type) {
          if (
            def.dependency[type] &&
            Object.keys(def.dependency[type]).length > 0
          ) {
            let depsList = Object.keys(def.dependency[type])
              .filter((dep) => !def.dependency[type][dep][0].external)
              .filter((dep) =>
                def.dependency[type][dep].some(
                  (meta) =>
                    meta.architecture.length === 0 ||
                    meta.architecture.includes(arch)
                )
              )
              .join(',' + depsPattern + ',');
            depsList += ',' + depsPattern;

            /* Continue recursively for the dependencies of this dependency. */
            deps[type] = extractPackages(
              depsList,
              distribution,
              resp,
              withMake,
              _pkgs
            );
            results = _.union(results, deps[type].list);
          }
        });

      prev = null;
    });
  }

  return {
    list: results,
    all,
    distribution,
  };
};

function getDistribution(msg) {
  return msg.data.distribution && msg.data.distribution.length > 1
    ? msg.data.distribution.replace(/([^/]+).*/, '$1/')
    : null;
}

const wrapOverwatch = watt(function* (func, msg, resp, next) {
  func = watt(func);

  if (msg.data._ignoreOverwatch) {
    yield func();
    return;
  }

  try {
    yield resp.command.send('overwatch.clear-all-errors', null, next);
    yield func();
  } finally {
    const {data} = yield resp.command.send(
      'overwatch.get-all-errors',
      null,
      next
    );
    yield utils.errorReporting(resp)(data);
  }
});

cmd.list = function (msg, resp) {
  try {
    resp.log.info('list of all products');

    var list = require('./lib/list.js');
    var results = list.listProducts(resp);
    resp.log.info.table(results);
  } catch (ex) {
    resp.events.send(`pacman.list.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.list.${msg.id}.finished`, results);
  }
};

cmd.listStatus = function* (msg, resp, next) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);
  let list = [];

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const {pattern} = msg.data;
    const distribution = getDistribution(msg);

    list = yield wpkg.list(arch, distribution, pattern, next);
  } catch (ex) {
    resp.events.send(`pacman.listStatus.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.listStatus.${msg.id}.finished`, list);
  }
};

cmd.listCheck = function* (msg, resp, next) {
  try {
    const distribution = getDistribution(msg);
    const {data: listFromDefs} = yield resp.command.send(
      'pacman.list',
      {},
      next
    );
    const {data: listFromRoot} = yield resp.command.send(
      'pacman.listStatus',
      {distribution},
      next
    );

    for (const {Name, Version} of listFromRoot) {
      const pkgDef = listFromDefs.find((pkg) => pkg.Name === Name);
      if (!pkgDef) {
        continue;
      }

      if (Version === pkgDef.Version) {
        continue;
      }

      const comp = yield debversion(Version, pkgDef.Version);
      if (comp < 0) {
        continue;
      }

      /* The version in the definition is lower, it's bad */
      resp.log.err(
        `${pkgDef.Name} in the definitions has a lower version than in the root directory: ${pkgDef.Version} < ${Version}\nPlease, fix the definitions!`
      );
    }
  } catch (ex) {
    resp.events.send(`pacman.listCheck.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.listCheck.${msg.id}.finished`);
  }
};

cmd.search = function* (msg, resp, next) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);
  let list = [];

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const {pattern} = msg.data;
    const distribution = getDistribution(msg);

    list = yield wpkg.search(arch, distribution, pattern, next);
  } catch (ex) {
    resp.events.send(`pacman.search.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.search.${msg.id}.finished`, list);
  }
};

cmd.unlock = function* (msg, resp, next) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const distribution = getDistribution(msg);

    yield wpkg.unlock(arch, distribution, next);
  } catch (ex) {
    resp.events.send(`pacman.unlock.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.unlock.${msg.id}.finished`, list);
  }
};

/**
 * Create a new package template or modify an existing package config file.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.edit = function (msg, resp) {
  var packageName = msg.data.packageName || '';

  msg.data.wizardImpl = xWizard.stringify(path.join(__dirname, './wizard.js'));
  msg.data.wizardAnswers = [];
  msg.data.wizardEditId = msg.id;

  resp.log.info('create a new package: ' + packageName);

  try {
    resp.command.send('pacman.edit.header', msg.data);
  } catch (err) {
    resp.log.err(err);
  }
};

cmd['edit.header'] = function (msg, resp) {
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  /* The first question is the package's name, then we set the default value. */
  var wizard = {
    package: msg.data.packageName,
  };

  var def = definition.load(msg.data.packageName, null, resp);

  wizard.subPackages = def.subpackage.join(',');
  wizard.version = def.version;
  wizard.tool = def.distribution === pacmanConfig.pkgToolchainRepository;
  if (!wizard.tool) {
    wizard.distribution = def.distribution;
  }
  wizard.maintainerName = def.maintainer.name;
  wizard.maintainerEmail = def.maintainer.email;
  wizard.architecture = def.architecture;
  wizard.descriptionBrief = def.description.brief;
  wizard.descriptionLong = def.description.long;
  wizard.bump = def.bump;

  msg.data.wizardName = 'header';
  msg.data.wizardDefaults = wizard;

  /* Prepare for dependency wizard. */
  msg.data.idxDep = 0;
  msg.data.idxRange = 0;
  msg.data.depType = 'install';
  msg.data.nextStep = 'edit.data';

  msg.data.nextCommand = 'pacman.edit.askdep';

  resp.events.send('pacman.edit.added', msg.data);
  resp.events.send(`pacman.edit.header.${msg.id}.finished`);
};

cmd['edit.askdep'] = function (msg, resp) {
  var wizard = {};

  var wizardName = 'askdep/' + msg.data.depType;

  var def = definition.load(msg.data.packageName, null, resp);
  var keys = Object.keys(def.dependency[msg.data.depType]);

  if (keys.length > msg.data.idxDep) {
    var key = keys[msg.data.idxDep];

    if (def.dependency[msg.data.depType][key].length > msg.data.idxRange) {
      wizard.hasDependency = true;
    } else if (keys.length > msg.data.idxDep + 1) {
      wizard.hasDependency = true;
      msg.data.idxDep++;
      msg.data.idxRange = 0;
    } else {
      wizard.hasDependency = false;
    }
  }

  msg.data.wizardName = wizardName;
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.dependency';

  resp.events.send('pacman.edit.added', msg.data);
  resp.events.send(`pacman.edit.askdep.${msg.id}.finished`);
};

cmd['edit.dependency'] = function (msg, resp) {
  var wizard = {
    version: '',
  };

  if (
    msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasDependency ===
    false
  ) {
    cmd[msg.data.nextStep](msg, resp);
    resp.events.send(`pacman.edit.dependency.${msg.id}.finished`);
    return;
  }

  var wizardName = 'dependency/' + msg.data.depType;

  var def = definition.load(msg.data.packageName, null, resp);
  var keys = Object.keys(def.dependency[msg.data.depType]);

  if (keys.length > msg.data.idxDep) {
    var key = keys[msg.data.idxDep];

    if (def.dependency[msg.data.depType][key].length > msg.data.idxRange) {
      wizard[wizardName] = key;
      wizard.version =
        def.dependency[msg.data.depType][key][msg.data.idxRange].version;
      wizard.architecture =
        def.dependency[msg.data.depType][key][msg.data.idxRange].architecture;
      if (def.dependency[msg.data.depType][key][msg.data.idxRange].subpackage) {
        wizard.subPackages = def.dependency[msg.data.depType][key][
          msg.data.idxRange
        ].subpackage.join(',');
      }
      wizard.external =
        def.dependency[msg.data.depType][key][msg.data.idxRange].external;
      msg.data.idxRange++;
    } else {
      msg.data.idxDep++;
    }
  }

  msg.data.wizardName = wizardName;
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.askdep';

  resp.events.send('pacman.edit.added', msg.data);
  resp.events.send(`pacman.edit.dependency.${msg.id}.finished`);
};

cmd['edit.data'] = function (msg, resp) {
  var wizard = {};

  var def = definition.load(msg.data.packageName, null, resp);

  wizard.uri = def.data.get.uri;
  wizard.mirrors = def.data.get.mirrors.join(',');
  wizard.uriRef = def.data.get.ref;
  wizard.uriOut = def.data.get.out;
  wizard.uriExternals = def.data.get.externals;
  wizard.prepareCmd = def.data.get.prepare;
  wizard.fileType = def.data.type;
  wizard.configureCmd = def.data.configure;
  wizard.rulesType = def.data.rules.type;
  wizard.rulesTest = def.data.rules.test;
  wizard.rulesLocation = def.data.rules.location;
  wizard.rulesEnv = def.data.rules.env;
  wizard.rulesArgsPostinst = def.data.rules.args.postinst;
  wizard.rulesArgsPrerm = def.data.rules.args.prerm;
  wizard.rulesArgsMakeall = def.data.rules.args.makeall;
  wizard.rulesArgsMaketest = def.data.rules.args.maketest;
  wizard.rulesArgsMakeinstall = def.data.rules.args.makeinstall;
  wizard.deployCmd = def.data.deploy;
  wizard.registerPath = def.data.env.path.join(',');
  const registerPathSub = {};
  Object.keys(def.data.env)
    .filter((key) => key.startsWith('path/'))
    .forEach((key) => {
      const sub = key.replace(/.*[/]/, '');
      registerPathSub[sub] = def.data.env[key].join(',');
    });
  wizard.registerPathSub = JSON.stringify(registerPathSub);
  wizard.embedded = def.data.embedded;
  if (def.data.runtime) {
    wizard.runtimeConfigureCmd = def.data.runtime.configure;
  }

  msg.data.wizardName = 'data';
  msg.data.wizardDefaults = wizard;
  msg.data.idxEnv = 0;

  /* Ask for build dependencies only with source packages. */
  if (
    msg.data.wizardAnswers.some(function (wizard) {
      return Object.keys(wizard).some(function (it) {
        return (
          it === 'architecture' &&
          wizard[it].some(function (arch) {
            return arch === 'source';
          })
        );
      });
    })
  ) {
    /* Prepare for dependency wizards. */
    msg.data.idxDep = 0;
    msg.data.idxRange = 0;
    msg.data.depType = 'build';
    msg.data.nextStep = 'edit.make';

    msg.data.nextCommand = 'pacman.edit.askdep';
  } else {
    msg.data.nextCommand = 'pacman.edit.make';
  }

  resp.events.send('pacman.edit.added', msg.data);
  resp.events.send(`pacman.edit.data.${msg.id}.finished`);
};

cmd['edit.make'] = (msg, resp) => {
  /* Prepare for dependency wizards. */
  msg.data.idxDep = 0;
  msg.data.idxRange = 0;
  msg.data.depType = 'make';
  msg.data.nextStep = 'edit.rulesEnv';
  cmd['edit.askdep'](msg, resp);

  resp.events.send(`pacman.edit.make.${msg.id}.finished`);
};

cmd['edit.rulesEnv'] = function (msg, resp) {
  var wizard = {};

  /* Continue when the key is an empty string. */
  if (
    msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasOwnProperty(
      'key1'
    ) &&
    !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].key1.length
  ) {
    msg.data.idxEnv = 0;
    cmd[msg.data.nextStep](msg, resp);
    resp.events.send(`pacman.edit.rulesEnv.${msg.id}.finished`);
    return;
  }

  var def = definition.load(msg.data.packageName, null, resp);
  var keys = Object.keys(def.data.rules.env);

  if (keys.length > msg.data.idxEnv) {
    var key = keys[msg.data.idxEnv];
    wizard.key1 = key;
    wizard.value = def.data.rules.env[key];
    msg.data.idxEnv++;
  }

  msg.data.wizardName = 'rulesEnv';
  msg.data.wizardDefaults = wizard;
  msg.data.nextStep = 'edit.env';

  msg.data.nextCommand = 'pacman.edit.rulesEnv';

  resp.events.send('pacman.edit.added', msg.data);
  resp.events.send(`pacman.edit.rulesEnv.${msg.id}.finished`);
};

cmd['edit.env'] = function (msg, resp) {
  var wizard = {};

  /* Continue when the key is an empty string. */
  if (
    msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasOwnProperty(
      'key0'
    ) &&
    !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].key0.length
  ) {
    msg.data.idxEnv = 0;
    cmd[msg.data.nextStep](msg, resp);
    resp.events.send(`pacman.edit.env.${msg.id}.finished`);
    return;
  }

  var def = definition.load(msg.data.packageName, null, resp);
  var keys = Object.keys(def.data.env.other);

  if (keys.length > msg.data.idxEnv) {
    var key = keys[msg.data.idxEnv];
    wizard.key0 = key;
    wizard.value = def.data.env.other[key];
    msg.data.idxEnv++;
  }

  msg.data.wizardName = 'env';
  msg.data.wizardDefaults = wizard;
  msg.data.nextStep = 'edit.save';

  msg.data.nextCommand = 'pacman.edit.env';

  resp.events.send('pacman.edit.added', msg.data);
  resp.events.send(`pacman.edit.env.${msg.id}.finished`);
};

cmd['edit.save'] = function (msg, resp) {
  var create = require('./lib/edit.js');

  var wizardAnswers = msg.data.wizardAnswers;

  create.pkgTemplate(
    wizardAnswers,
    resp,
    function (wizardName, file) {
      msg.data.wizardName = wizardName;
      msg.data.wizardDefaults = {};

      msg.data.chestFile = file;

      msg.data.nextCommand = 'pacman.edit.upload';

      resp.events.send('pacman.edit.added', msg.data);
    },
    function (err, useChest) {
      if (err) {
        resp.log.err(err);
      }
      resp.events.send(`pacman.edit.save.${msg.id}.finished`);
      if (!useChest) {
        resp.events.send(`pacman.edit.${msg.data.wizardEditId}.finished`);
      }
    }
  );
};

cmd['edit.upload'] = function (msg, resp) {
  const chestConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-chest'
  );

  if (
    !chestConfig ||
    !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].mustUpload
  ) {
    resp.events.send(`pacman.edit.upload.${msg.id}.finished`);
    resp.events.send(`pacman.edit.${msg.data.wizardEditId}.finished`);
    return;
  }

  resp.log.info(
    'upload %s to chest://%s:%d',
    msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath,
    chestConfig.host,
    chestConfig.port
  );

  resp.events.subscribe(`chest.send.${msg.id}.finished`, function () {
    resp.events.unsubscribe(`chest.send.${msg.id}.finished`);
    resp.events.send(`pacman.edit.upload.${msg.id}.finished`);
    resp.events.send(`pacman.edit.${msg.data.wizardEditId}.finished`);
  });

  var chestMsg = {
    file: msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath,
  };
  resp.command.send('chest.send', chestMsg);
};

/**
 * Make the Control file for WPKG by using a package config file.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 * @param {function} next - Watt's callback.
 */
cmd.make = function* (msg, resp, next) {
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );
  const make = require('./lib/make.js')(resp);

  let packageRefs = null;
  let distribution = pacmanConfig.pkgToolchainRepository;
  const packageArgs = {};
  const packageArgsOther = {};

  if (msg.data.packageArgs) {
    /* Retrieve the packageRef if available. */
    if (!/^p:/.test(msg.data.packageArgs[0])) {
      packageRefs = msg.data.packageArgs.shift();
    }

    /* Transform all properties to a map. */
    msg.data.packageArgs.forEach((arg) => {
      let match = arg.trim().match(/^p:(?:([^:]*):)?([^=]*)[=](.*)/);
      if (match) {
        if (match[1]) {
          if (!packageArgs[match[1]]) {
            packageArgs[match[1]] = {};
          }
          packageArgs[match[1]][match[2]] = match[3];
        } else {
          packageArgsOther[match[2]] = match[3];
        }
      } else {
        match = arg.trim().match(/^d:([a-z0-9]+[+][a-z0-9]+)/);
        if (match) {
          distribution = `${match[1]}/`;
        }
      }
    });
  }

  resp.log.verb(
    'list of overloaded properties: %s %s',
    JSON.stringify(packageArgsOther, null, 2),
    JSON.stringify(packageArgs, null, 2)
  );

  const pkgs = extractPackages(packageRefs, distribution, resp).list;
  let status = resp.events.status.succeeded;

  const cleanArg = {};
  if (packageRefs) {
    cleanArg.packageNames = pkgs.join(',');
    cleanArg.distribution = distribution;
  }

  try {
    yield resp.command.send('pacman.clean', cleanArg, next);
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    resp.events.send(`pacman.make.${msg.id}.finished`);
    return;
  }

  function* _make(packageRef, props, bumpPkg) {
    const pkg = utils.parsePkgRef(packageRef);
    const pkgDef = definition.getBasePackageDef(pkg.name, resp);
    pkg.name = pkgDef.name;

    resp.log.info(
      'make the wpkg package for ' + pkg.name + ' on architecture: ' + pkg.arch
    );

    let pkgArgs = props;
    if (packageArgs.hasOwnProperty(pkg.name)) {
      pkgArgs = packageArgs[pkg.name];
    }

    try {
      const result = yield make.package(
        pkg.name,
        pkg.arch,
        pkgArgs,
        null,
        distribution !== pacmanConfig.pkgToolchainRepository
          ? distribution
          : null
      );
      if (result.bump.length) {
        /* Complete the bump list if necessary */
        for (const b of result.bump) {
          bumpPkg[b] |= false;
        }
      }
      if (result.make) {
        if (bumpPkg.hasOwnProperty(pkg.name)) {
          /* It's already re-maked, bump is useless */
          bumpPkg[pkg.name] = true;
        }
        return true;
      }
      return false;
    } catch (ex) {
      let _ex = ex;
      if (!Array.isArray(ex)) {
        _ex = [ex];
      }
      for (const ex of _ex) {
        resp.log.err(ex.stack || ex.message || ex);
      }
      status = resp.events.status.failed;
    }
  }

  function* _makeList(pkgs, getProps, makeList) {
    /* List of packages to bump when this pkg-name is changed / new */
    const bumpPkg = {};

    for (const packageRef of pkgs) {
      const props = getProps(packageRef);
      const isMake = yield* _make(packageRef, props, bumpPkg);
      if (isMake) {
        makeList[packageRef] = true;
      }
    }

    return bumpPkg;
  }

  try {
    yield wrapOverwatch(
      function* () {
        const makeList = {};
        let bumpPkg = yield* _makeList(pkgs, () => packageArgsOther, makeList);
        let list = Object.keys(bumpPkg);

        while (list.length) {
          bumpPkg = yield* _makeList(
            list
              .filter(
                /* Only if the bump is useful and if it's the main list */
                (pkg) => !bumpPkg[pkg] && pkgs.includes(pkg)
              )
              .filter(
                /* Only if not already changed */
                (pkg) => !makeList[pkg]
              ),
            () => ({p: 'p'}),
            makeList
          );
          list = Object.keys(bumpPkg);
        }
      },
      msg,
      resp
    );
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  }

  resp.events.send(`pacman.make.${msg.id}.finished`, status);
};

function* install(msg, resp, reinstall = false) {
  const install = require('./lib/install.js')(resp);

  const subCmd = reinstall ? 'reinstall' : 'install';

  const {prodRoot, version} = msg.data;

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  let status = resp.events.status.succeeded;

  for (const packageRef of pkgs) {
    try {
      if (version) {
        yield install.packageArchive(
          packageRef,
          version,
          distribution,
          prodRoot,
          reinstall
        );
      } else {
        yield install.package(packageRef, distribution, prodRoot, reinstall);
      }
      if (!prodRoot) {
        xEnv.devrootUpdate(distribution);
      }
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.${subCmd}.${msg.id}.finished`, status);
}

/**
 * Try to install the developement package.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.install = function* (msg, resp) {
  yield* install(msg, resp, false);
};

/**
 * Try to reinstall the developement package.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.reinstall = function* (msg, resp) {
  yield* install(msg, resp, true);
};

cmd.upgrade = function* (msg, resp, next) {
  const {getTargetRoot} = require('.');
  const wpkg = require('xcraft-contrib-wpkg')(resp);
  let status = resp.events.status.succeeded;

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const {distribution} = msg.data;
    const targetRoot = getTargetRoot(distribution, resp);

    yield wpkg.update(arch, targetRoot, next);
    yield wpkg.upgrade(arch, targetRoot, next);
    xEnv.devrootUpdate(distribution);
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  } finally {
    resp.events.send(`pacman.upgrade.${msg.id}.finished`, status);
  }
};

/**
 * Test if a package is installed or published.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.status = function* (msg, resp) {
  const install = require('./lib/install.js')(resp);
  const publish = require('./lib/publish.js')(resp);

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  var status = resp.events.status.succeeded;

  try {
    let installStatus;
    let publishStatus;

    for (const packageRef of pkgs) {
      const {installed} = yield install.status(packageRef, distribution);
      installStatus = {
        packageRef: packageRef,
        installed,
      };

      const deb = yield publish.status(packageRef, null, null);
      publishStatus = {
        packageRef: packageRef,
        published: deb.file,
      };
    }

    const res = _.merge(installStatus, publishStatus);
    resp.events.send('pacman.status', res);
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  } finally {
    resp.events.send(`pacman.status.${msg.id}.finished`, status);
  }
};

/**
 * Show informations about a package.
 *
 * @yields
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 * @param {function} next - Watt's callback.
 */
cmd.show = function* (msg, resp, next) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);

  const {packageRef} = msg.data;
  let distribution = getDistribution(msg);
  const version = msg.data.version;

  try {
    const out = {};
    const pkg = utils.parsePkgRef(packageRef);
    const dump = yield wpkg.show(
      pkg.name,
      pkg.arch,
      version,
      distribution,
      next
    );
    out[packageRef] = dump;

    /* For the REPL */
    Object.keys(dump)
      .filter((key) => dump[key] !== 'undefined')
      .forEach((key) => {
        if (/(Depends|X-Craft)/.test(key)) {
          resp.log.dbg(`${key}:`);
          dump[key]
            .split(', ')
            .sort()
            .forEach((entry) => resp.log.dbg(`  ${entry}`));
        } else {
          resp.log.dbg(`${key}: ${dump[key]}`);
        }
      });

    resp.events.send(`pacman.show.${msg.id}.finished`, out);
  } catch (ex) {
    resp.log.err(ex.stack || ex.message || ex);
    resp.events.send(`pacman.show.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

function* getPackageBOM(
  resp,
  packageRef,
  version,
  distribution,
  processed = {},
  next
) {
  if (processed[`${packageRef}-${version}-${distribution}`]) {
    return {};
  }

  processed[`${packageRef}-${version}-${distribution}`] = true;

  const show = function* ({name, arch}, version, distribution, next) {
    const wpkg = require('xcraft-contrib-wpkg')(resp);
    return yield wpkg.show(name, arch, version, distribution, next);
  };

  const explode = (deps, entry) =>
    entry &&
    entry !== 'undefined' &&
    entry
      .split(', ')
      .map((s) => s.split(' ', 1)[0])
      .reduce((deps, name) => {
        let value = {version: null};
        const x = name.split('@');
        if (x.length > 1) {
          name = x[1];
          value.extern = x[0].substring(1);
        }
        deps[name] = value;
        return deps;
      }, deps);

  const extractForSrc = function (pkg) {
    const deps = {};
    explode(deps, pkg.Depends);
    explode(deps, pkg['Build-Depends']);
    explode(deps, pkg['X-Craft-Build-Depends']);
    return deps;
  };

  const extractForBin = function (pkg) {
    const deps = {};
    explode(deps, pkg.Depends);
    return deps;
  };

  const injectVersions = function (pkg, deps) {
    const versions = pkg[`X-Craft-Packages-${distribution.replace('/', '')}`]
      .split(', ')
      .filter((entry) => entry !== 'undefined')
      .map((entry) => {
        const m = entry.match(/([^ ]+) \((.*)\)/);
        return {
          name: m[1],
          version: m[2],
        };
      })
      .reduce((versions, entry) => {
        versions[entry.name] = entry.version;
        return versions;
      }, {});

    /* Remove not installed deps */
    Object.keys(deps)
      .filter((dep) => !versions[dep])
      .forEach((dep) => delete deps[dep]);

    /* Inject the version provided by the binary package */
    Object.keys(deps).forEach((dep) => {
      deps[dep][versions[dep]] = {};
      deps[dep].version = versions[dep];
    });
  };

  let deps;

  /* 1. pacman.show of bin package (for distrib dep versions) */
  let binPkg;
  let binPkgInfo;
  try {
    binPkg = utils.parsePkgRef(packageRef);
    binPkgInfo = yield* show(binPkg, version, distribution, next);
  } catch (ex) {
    if (ex !== 'package not found') {
      throw ex;
    }

    return {
      [binPkg.name]: {version, [version]: {missing: true}},
    };
  }

  /* 2. pacman.show of src package (for deps) */
  try {
    const name = binPkg.name.replace(/(?:-stub|-src|-dev)$/, '');
    const srcPkg = {...binPkg, ...{name: `${name}-src`}};
    const srcPkgInfo = yield* show(srcPkg, version, 'sources', next);

    /* 3. Extract dependencies of the src package */
    const srcDeps = extractForSrc(srcPkgInfo);

    /* 4. Extract versions of src dependencies */
    injectVersions(binPkgInfo, srcDeps);

    deps = {
      ...deps,
      [name]: {version: srcPkgInfo.Version, [srcPkgInfo.Version]: {}},
      ...srcDeps,
    };
  } catch (ex) {
    if (ex !== 'package not found') {
      throw ex;
    }

    /* 3. Extract dependencies of the bin package
     * FIXME: the versions are not available, it needs to add the
     *        toolchain deps list in bin package too
     */
    deps = extractForBin(binPkgInfo);
  }

  for (const dep of Object.keys(deps)) {
    const _deps = yield* getPackageBOM(
      resp,
      dep,
      deps[dep].version,
      distribution,
      processed,
      next
    );

    for (const _dep in _deps) {
      const _version = _deps[_dep].version;
      if (!deps[_dep]) {
        deps[_dep] = _deps[_dep];
      } else if (_version && !deps[_dep][_version]) {
        deps[_dep][_version] = _deps[_dep][_version];
      }
    }
  }

  return {
    ...deps,
    [binPkg.name]: {
      version: binPkgInfo.Version,
      [binPkgInfo.Version]: {},
    },
  };
}

cmd.bom = function* (msg, resp, next) {
  const {packageRef} = msg.data;
  let distribution = getDistribution(msg);
  const version = msg.data.version;

  try {
    const pkgBOM = yield* getPackageBOM(
      resp,
      packageRef,
      version,
      distribution,
      {},
      next
    );

    const keys = Object.keys(pkgBOM).sort();
    const pkg = utils.parsePkgRef(packageRef);
    const nameLength =
      Object.keys(pkgBOM)
        .map((name) => name.length)
        .reduce((max, cur) => (cur > max ? cur : max), 0) + 5;

    for (const name of keys) {
      const versions = Object.keys(pkgBOM[name])
        .filter((e) => e !== 'version' && e !== 'extern')
        .join(', ');
      resp.log.dbg(
        `${name === pkg.name ? '×' : ' '} ${name} ${new Array(
          nameLength - name.length
        ).join(' ')} ${pkgBOM[name].extern ? 'extern' : '      '} ${versions}`
      );
    }

    resp.events.send(`pacman.bom.${msg.id}.finished`, pkgBOM);
  } catch (ex) {
    resp.log.err(ex.stack || ex.message || ex);
    resp.events.send(`pacman.bom.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

/**
 * Try to compile the sources of a source package.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.build = function* (msg, resp) {
  const build = require('./lib/build.js')(resp);

  let pkgs = [null];
  const {all, list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  if (!all) {
    pkgs = list;
  }

  let status = resp.events.status.succeeded;

  /* Try to build most of packages; continue with the next on error. */
  try {
    yield wrapOverwatch(
      function* () {
        for (const packageRef of pkgs) {
          try {
            yield build.package(packageRef, distribution);
            xEnv.devrootUpdate(distribution);
          } catch (ex) {
            resp.log.err(ex.stack || ex);
            status = resp.events.status.failed;
          }
        }
      },
      msg,
      resp
    );
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  }

  resp.events.send(`pacman.build.${msg.id}.finished`, status);
};

cmd['zeroBuild'] = function* (msg, resp) {
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  const build = require('./lib/build.js')(resp);

  const {packageRef} = msg.data;
  let distribution = getDistribution(msg);
  if (!distribution) {
    const def = definition.load(packageRef, null, resp, null);
    distribution = def.distribution;
  }

  const pkg = utils.parsePkgRef(packageRef);

  process.env.PEON_DEBUG_PKG = pkg.name;

  try {
    yield build.package(packageRef, distribution);
    resp.log.info(
      colors.blueBright(
        colors.bold(
          `Go to the source directory of ${packageRef} in the ${
            distribution || pacmanConfig.pkgToolchainRepository
          } distribution.\n` +
            `A 'source-debug-env.(sh|cmd)' script can be used in order to manually load the build environment.`
        )
      ) + ' '
    );
    resp.events.send(`pacman.zeroBuild.${msg.id}.finished`);
  } catch (ex) {
    resp.log.err(ex.stack || ex.message || ex);
    resp.events.send(`pacman.zeroBuild.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    delete process.env.PEON_DEBUG_PKG;
  }
};

function* full(msg, resp) {
  const fullpac = require('./lib/fullpac.js');

  if (new RegExp(depsPattern).test(msg.data.packageRefs)) {
    throw new Error(
      `The use of ${depsPattern} pattern is prohibited with the 'full' command`
    );
  }

  let pkgs = [null];
  const {all, list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );

  if (all) {
    throw new Error(
      "You must specify at least one package; you can't use this command to fullpac all packages"
    );
  }

  pkgs = list;

  yield wrapOverwatch(
    function* () {
      for (const packageRef of pkgs) {
        yield fullpac(resp, packageRef, true, distribution);
      }
    },
    msg,
    resp
  );
}

cmd.full = function* (msg, resp) {
  let status = resp.events.status.succeeded;

  try {
    yield* full(msg, resp);
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  }

  resp.events.send(`pacman.full.${msg.id}.finished`, status);
};

/**
 * Try to remove the developement package.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.remove = function* (msg, resp) {
  const remove = require('./lib/remove.js')(resp);

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  let status = resp.events.status.succeeded;

  const recursive =
    msg.data.recursive && /^(1|true|y|yes)$/.test(msg.data.recursive);

  for (const packageRef of pkgs) {
    try {
      yield remove.package(packageRef, distribution, recursive);
      xEnv.devrootUpdate(distribution);
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.remove.${msg.id}.finished`, status);
};

/**
 * Try to remove all package that are installed in a distribution.
 *
 * Here we use a trick. Instead of trying to remove explicitly each package
 * with the recursive flag (it's possible to have errors in this case), we
 * change the selection mode of all packages. When the selection is set to
 * 'auto', it means that wpkg considers that these packages are not installed
 * explicitly, then the autoremove wpkg command is able to remove all packages
 * with this mode.
 *
 * @yields
 * @param {object} msg - Xcraft message.
 * @param {object} resp - Response object.
 * @param {Function} next - Watt's callback.
 */
cmd.removeAll = function* (msg, resp, next) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);
  let list = [];

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const distribution = getDistribution(msg);

    if (!wpkg.targetExists(distribution)) {
      resp.events.send(`pacman.removeAll.${msg.id}.finished`, list);
      return;
    }

    list = yield wpkg.list(arch, distribution, null, next);
    for (const {Name} of list) {
      yield wpkg.setSelection(Name, arch, 'auto', distribution);
    }

    yield wpkg.autoremove(arch, distribution);
    xEnv.devrootUpdate(distribution);
  } catch (ex) {
    resp.events.send(`pacman.removeAll.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.removeAll.${msg.id}.finished`, list);
  }
};

/**
 * Autoremove implicit packages.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.autoremove = function* (msg, resp) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const distribution = getDistribution(msg);

    yield wpkg.autoremove(arch, distribution);
    xEnv.devrootUpdate(distribution);
  } catch (ex) {
    resp.events.send(`pacman.autoremove.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.autoremove.${msg.id}.finished`);
  }
};

/**
 * Remove all the generated files from the temporary directory.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.clean = function (msg, resp) {
  const clean = require('./lib/clean.js')(resp);

  const {list} = extractPackages(
    msg.data.packageNames,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  let status = resp.events.status.succeeded;

  for (const packageName of pkgs) {
    try {
      clean.temp(packageName);
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.clean.${msg.id}.finished`, status);
};

/**
 * Publish a package in a specified repository.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.publish = function* (msg, resp) {
  const publish = require('./lib/publish.js')(resp);

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  let status = resp.events.status.succeeded;

  /* Try to publish most of packages; continue with the next on error. */
  for (const packageRef of pkgs) {
    try {
      yield publish.add(
        packageRef,
        null,
        msg.data.outputRepository,
        distribution
      );
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.publish.${msg.id}.finished`, status);
};

/**
 * Unpublish a package.
 *
 * @param {Object} msg - Xcraft message.
 * @param {Object} resp - Response object.
 */
cmd.unpublish = function* (msg, resp) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);
  const publish = require('./lib/publish.js')(resp);

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  let haveSrc = false;
  const pkgs = list;
  let status = resp.events.status.succeeded;

  if (!wpkg.targetExists(distribution)) {
    resp.events.send(`pacman.unpublish.${msg.id}.finished`, status);
    return;
  }

  /* Try to unpublish most of packages; continue with the next on error. */
  for (const [, packageRef] of pkgs.entries()) {
    const pkg = utils.parsePkgRef(packageRef);
    haveSrc = pkg.name.endsWith('-src');
    try {
      yield publish.remove(packageRef, null, distribution, false);
    } catch (ex) {
      resp.log.warn(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  yield wpkg.syncRepository(distribution);
  if (haveSrc) {
    yield wpkg.syncRepository('sources/');
  }

  resp.events.send(`pacman.unpublish.${msg.id}.finished`, status);
};

cmd.addSource = function* (msg, resp) {
  const admindir = require('./lib/admindir.js')(resp);

  let status = resp.events.status.succeeded;

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const {uri, distribution, location, components} = msg.data;

    yield admindir.create(null, null, distribution);
    yield admindir.addSource(
      uri,
      arch,
      distribution,
      location,
      components.split(',')
    );
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  } finally {
    resp.events.send(`pacman.addSource.${msg.id}.finished`, status);
  }
};

cmd.delSource = function* (msg, resp) {
  const admindir = require('./lib/admindir.js')(resp);

  let status = resp.events.status.succeeded;

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const {uri, distribution, location, components} = msg.data;

    yield admindir.delSource(
      uri,
      arch,
      distribution,
      location,
      components.split(',')
    );
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  } finally {
    resp.events.send(`pacman.delSource.${msg.id}.finished`, status);
  }
};

cmd.syncRepository = function* (msg, resp) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);

  try {
    const distribution = getDistribution(msg);

    yield wpkg.syncRepository(distribution);
  } catch (ex) {
    resp.events.send(`pacman.syncRepository.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  } finally {
    resp.events.send(`pacman.syncRepository.${msg.id}.finished`);
  }
};

cmd.graph = function* (msg, resp) {
  const {graph} = require('./lib/graph.js')(resp);

  const {list, distribution} = extractPackages(
    msg.data.packageNames,
    getDistribution(msg),
    resp,
    true
  );
  let status = resp.events.status.succeeded;

  try {
    yield graph(list, distribution);
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    status = resp.events.status.failed;
  }

  resp.events.send(`pacman.graph.${msg.id}.finished`, status);
};

cmd.version = function* (msg, resp) {
  const url = require('url');
  const semver = require('semver');
  const clone = require('clone');
  const urlExist = require('url-exist');
  const xFtp = require('xcraft-core-ftp');
  const xPeonUtils = require('xcraft-contrib-peon/lib/utils.js');

  const {list} = extractPackages(
    msg.data.packageNames,
    getDistribution(msg),
    resp,
    true
  );
  let status = resp.events.status.succeeded;

  const V = colors.greenBright('✓');
  const X = colors.redBright('⨯');
  const H = colors.magentaBright('?');

  const checked = {};

  const checkVersion = watt(function* (type, uri) {
    let status = X;
    switch (type) {
      case 'http': {
        if (yield urlExist(uri)) {
          status = V;
        }
        break;
      }
      case 'ftp': {
        try {
          const uriObj = url.parse(uri);
          const size = yield xFtp.size(uriObj);
          status = size > 0 ? V : H;
        } catch (ex) {
          status = X;
        }
        break;
      }
      default:
        status = H;
    }
    return status;
  });

  const check = watt(function* (packageRef, nextVersion = null) {
    const pkg = utils.parsePkgRef(packageRef);
    const packageDef = definition.load(pkg.name, {}, resp, null);
    const getObj = utils.makeGetObj(clone(packageDef));
    const type = xPeonUtils.typeFromUri(getObj);
    if (!type) {
      return;
    }

    if (nextVersion) {
      packageDef.$version = semver.inc(nextVersion, 'patch');
    }

    const versions = [];
    versions.push(`${packageDef.$version}`);

    let version0 = versions[0];
    const length = version0.split('.').length;
    if (length <= 3 && getObj.uri !== packageDef.data.get.uri) {
      switch (length) {
        case 1:
          version0 += '.0';
        // eslint-disable-next-line no-fallthrough
        case 2:
          version0 += '.0';
      }
      if (length >= 3) {
        let version = semver.inc(version0, 'patch');
        versions.push(version);
      }
      if (length >= 2) {
        let version = semver.inc(version0, 'minor');
        if (version && length === 2) {
          version = version.split('.').slice(0, -1).join('.');
        }
        versions.push(version);
      }
      let version = semver.inc(version0, 'major');
      if (version && length <= 2) {
        version = version
          .split('.')
          .slice(0, length === 2 ? -1 : -2)
          .join('.');
      }
      versions.push(version);
    }

    let nextVersionCheck;

    for (const version of versions) {
      if (!version || checked[version]) {
        continue;
      }
      packageDef.$version = version;
      const getObj = utils.makeGetObj(clone(packageDef));
      const status = yield checkVersion(type, getObj.uri);

      if (status === V && version !== versions[0]) {
        nextVersionCheck = version;
      }

      if (version === versions[0] && !nextVersion) {
        resp.log.info(
          `[${status}] ${type.toUpperCase()}${new Array(5 - type.length).join(
            ' '
          )} ${pkg.name} v${version}`
        );
      } else {
        resp.log.info(` └ [${status}] v${version}`);
      }

      checked[version] = true;
    }

    return nextVersionCheck;
  });

  for (const [, packageRef] of list.entries()) {
    try {
      let nextVersion;
      do {
        nextVersion = yield check(packageRef, nextVersion);
      } while (nextVersion);
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.version.${msg.id}.finished`, status);
};

cmd.refrhash = function* (msg, resp, next) {
  const clone = require('clone');
  const make = require('./lib/make.js')(resp);
  const xPeonUtils = require('xcraft-contrib-peon/lib/utils.js');

  const xConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  const tmpDir = xConfig.tempRoot;

  try {
    const {list} = extractPackages(null, null, resp);

    for (const packageRef of list) {
      const pkg = utils.parsePkgRef(packageRef);
      const packageDef = definition.load(pkg.name, {}, resp, null);
      const getObj = utils.makeGetObj(clone(packageDef));

      const type = xPeonUtils.typeFromUri(getObj);
      if (!/http|ftp/.test(type)) {
        continue;
      }

      const tmp = path.join(tmpDir, 'refrhash');
      const $hash = getObj.$hash;
      getObj.$hash = '';
      try {
        const out = yield xPeonUtils.fileFromUri(getObj, tmp, true, resp, next);
        if (out.hash && out.hash !== $hash) {
          make.injectHash(pkg.name, out.hash);
        }
      } catch (ex) {
        resp.log.warn(ex.stack || ex.message || ex);
      } finally {
        fse.removeSync(tmp);
      }
    }
    resp.events.send(`pacman.refrhash.${msg.id}.finished`);
  } catch (ex) {
    resp.log.err(ex.stack || ex.message || ex);
    resp.events.send(`pacman.refrhash.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd.gitMergeDefinitions = function* (msg, resp, next) {
  const parseGitDiff = require('parse-git-diff');
  const xProcess = require('xcraft-core-process')({logger: 'none', resp});
  const xFs = require('xcraft-core-fs');
  const xConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  const keys = ['version', '$ref', '$hash'];

  const versionCleaner = (version) =>
    version
      .replace(/[^:]+:/, '')
      .trim()
      .replace(/['"]/g, '');

  const spawn = watt(function* (pkg, next) {
    let diff = '';
    yield xProcess.spawn(
      'git',
      ['diff', '--', pkg],
      {},
      next,
      (stdout) => (diff += stdout)
    );
    const result = parseGitDiff(diff);
    if (!result?.files[0]?.chunks) {
      return;
    }

    const def = {
      version: [null, null, null],
      $ref: [null, null, null],
      $hash: [null, null, null],
    };

    for (const chunk of result.files[0].chunks) {
      let added = 1;
      const changes = chunk.changes.filter(
        (change) => change.type === 'DeletedLine' || change.type === 'AddedLine'
      );
      changes.forEach((change) => {
        for (const key of keys) {
          if (
            new RegExp(`^[ +]*${key.replace('$', '\\$')}:`).test(change.content)
          ) {
            const idx = change.type === 'DeletedLine' ? 0 : added++;
            def[key][idx] = versionCleaner(change.content);
          }
        }
      });
    }

    let isConflict = !!def.version[2];

    if (!def.version[0]) {
      const _ver = diff.split('\n').filter((row) => /^ [+]?version:/.test(row));
      if (_ver.length !== 1) {
        resp.log.err(`unsupported merge conflict with ${pkg}`);
        return;
      }
      def.version[0] = versionCleaner(_ver[0]);
      isConflict = true;
    }

    if (def.version[0] && def.version[1]) {
      const pacmanDef = require('./lib/def.js');
      const comp = yield debversion(def.version[1], def.version[0]); // V2, V1
      const isV2Greater = comp > 0;

      if (isV2Greater) {
        def.version.shift();
        def.$ref.shift();
        def.$hash.shift();
      } else {
        def.version[1] = def.version[2];
        def.$ref[1] = def.$ref[2];
        def.$hash[1] = def.$hash[2];
        def.version[2] = null;
        def.$ref[2] = null;
        def.$hash[2] = null;
      }

      if (isConflict) {
        /* It's a merge conflict */
        if (def.version[1]) {
          const comp = yield debversion(def.version[1], def.version[0]); // V3, V2
          const isV3Greater = comp > 0;
          if (isV3Greater) {
            def.version.shift();
            def.$ref.shift();
            def.$hash.shift();
          }
        }

        /* Resolve conficts in the package definition, then
         * it's possible to load the file. This resolver is stupid
         * because the entries are just removed. It must be used
         * only for conflicts related to the versionning.
         */
        let inConflict = false;
        resp.log.warn(`check for the merge, this resolver is a bit stupid`);
        const data = fse
          .readFileSync(pkg, 'utf8')
          .split('\n')
          .reduce((merged, row) => {
            if (/^[ +]*<<<<<<</.test(row)) {
              inConflict = true;
              return merged;
            }
            if (/^[ +]*>>>>>>>/.test(row)) {
              inConflict = false;
              return merged;
            }
            if (inConflict) {
              if (!new RegExp(`(${keys.join('|')})`).test(row)) {
                resp.log.info(`skipped merge entry: ${row}`);
              }
              return merged;
            }
            merged.push(row);
            return merged;
          }, [])
          .join('\n');
        fse.writeFileSync(pkg, data);
      } else if (isV2Greater) {
        /* It's already the right version */
        return;
      }

      const packageName = path.basename(path.dirname(pkg));
      const pkgDef = pacmanDef.load(packageName, {}, resp);
      pkgDef.version = def.version[0];
      if (def.$ref[0]) {
        pkgDef.data.get.$ref = def.$ref[0];
      }
      if (def.$hash[0]) {
        pkgDef.data.get.$hash = def.$hash[0];
      }
      pacmanDef.save(pkgDef, null, resp);
    }
  });

  try {
    const packages = xFs
      .lsdir(xConfig.pkgProductsRoot)
      .filter((dir) => !dir.startsWith('.'))
      .map((pkg) =>
        path.join(xConfig.pkgProductsRoot, pkg, pacmanConfig.pkgCfgFileName)
      );

    for (const pkg of packages) {
      spawn(pkg, next.parallel());
    }
    yield next.sync();
    resp.events.send(`pacman.gitMergeDefinitions.${msg.id}.finished`);
  } catch (ex) {
    resp.log.err(ex.stack || ex.message || ex);
    resp.events.send(`pacman.gitMergeDefinitions.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd['_postload'] = function* (msg, resp, next) {
  try {
    yield debversion.init(); /* init for WASM */
    yield resp.command.send('overwatch.init', null, next);

    let {wpkgHttp} = require('./lib/index.js');
    wpkgHttp = wpkgHttp();
    if (wpkgHttp) {
      /* Main server for HTTP access to repositories */
      wpkgHttp.serve();
    }

    resp.events.send(`pacman._postload.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send(`pacman._postload.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: {
      'list': {
        parallel: true,
        desc: 'list all available packages from definitions',
      },
      'listStatus': {
        parallel: true,
        desc: 'list status of installed packages',
        options: {
          params: {
            optional: ['pattern', 'distribution', 'arch'],
          },
        },
      },
      'listCheck': {
        parallel: true,
        desc: 'check versions of installed packages versus definitions',
        options: {
          params: {
            optional: ['distribution'],
          },
        },
      },
      'search': {
        parallel: true,
        desc: 'search files in installed packages',
        options: {
          params: {
            required: 'pattern',
            optional: ['distribution', 'arch'],
          },
        },
      },
      'unlock': {
        desc: 'remove database lock',
        options: {
          params: {
            optional: ['distribution', 'arch'],
          },
        },
      },
      'edit': {
        desc: 'create or edit a package definition',
        options: {
          wizard: true,
          params: {
            optional: 'packageName',
          },
        },
      },
      'edit.header': {
        parallel: true,
      },
      'edit.askdep': {
        parallel: true,
      },
      'edit.dependency': {
        parallel: true,
      },
      'edit.data': {
        parallel: true,
      },
      'edit.make': {
        parallel: true,
      },
      'edit.rulesEnv': {
        parallel: true,
      },
      'edit.env': {
        parallel: true,
      },
      'edit.save': {
        parallel: true,
      },
      'edit.upload': {
        parallel: true,
      },
      'make': {
        desc: 'make all or only the specified package',
        options: {
          params: {
            optional: 'packageArgs...',
          },
        },
      },
      'install': {
        desc:
          'install the package (provide a prodRoot if you try to install a product)',
        options: {
          params: {
            optional: ['packageRefs', 'distribution', 'prodRoot', 'version'],
          },
        },
      },
      'reinstall': {
        desc:
          'install or reinstall the package (provide a prodRoot if you try to reinstall a product)',
        options: {
          params: {
            optional: ['packageRefs', 'distribution', 'prodRoot'],
          },
        },
      },
      'upgrade': {
        desc: 'upgrade the packages',
        options: {
          params: {
            optional: ['distribution', 'arch'],
          },
        },
      },
      'status': {
        desc: 'retrieve the status of a package',
        options: {
          params: {
            optional: ['packageRefs', 'distribution'],
          },
        },
      },
      'show': {
        parallel: true,
        desc: 'show informations about a package',
        options: {
          params: {
            optional: ['packageRef', 'version', 'distribution'],
          },
        },
      },
      'bom': {
        parallel: true,
        desc: 'dump BOM about a package',
        options: {
          params: {
            optional: ['packageRef', 'version', 'distribution'],
          },
        },
      },
      'build': {
        desc: 'compile a source package',
        options: {
          params: {
            optional: ['packageRefs', 'distribution'],
          },
        },
      },
      'zeroBuild': {
        desc: 'prepare a package for building (without starting the build)',
        options: {
          params: {
            required: 'packageRef',
            optional: ['distribution'],
          },
        },
      },
      'full': {
        desc: 'make, build and install packages',
        options: {
          params: {
            required: 'packageRefs',
            optional: ['distribution'],
          },
        },
      },
      'publish': {
        desc: 'publish the package',
        options: {
          params: {
            required: 'outputRepository',
            optional: ['packageRefs', 'distribution'],
          },
        },
      },
      'unpublish': {
        desc: 'unpublish the package',
        options: {
          params: {
            optional: ['packageRefs', 'distribution'],
          },
        },
      },
      'remove': {
        desc: 'remove the package',
        options: {
          params: {
            optional: ['packageRefs', 'distribution', 'recursive'],
          },
        },
      },
      'removeAll': {
        desc: 'remove all packages',
        options: {
          params: {
            optional: ['distribution', 'arch'],
          },
        },
      },
      'autoremove': {
        desc: 'autoremove implicit packages',
        options: {
          params: {
            optional: ['distribution', 'arch'],
          },
        },
      },
      'clean': {
        desc: 'remove the temporary package files',
        options: {
          params: {
            optional: ['packageNames', 'distribution'],
          },
        },
      },
      'addSource': {
        desc: 'add a new source to a target root',
        parallel: true,
        options: {
          params: {
            required: ['uri'],
            optional: ['distribution', 'arch', 'location', 'components'],
          },
        },
      },
      'delSource': {
        desc: 'delete a source from a target root',
        parallel: true,
        options: {
          params: {
            required: ['uri'],
            optional: ['distribution', 'arch', 'location', 'components'],
          },
        },
      },
      'syncRepository': {
        desc: 'synchronize archives repositories',
        parallel: true,
        options: {
          params: {
            optional: ['distribution'],
          },
        },
      },
      'graph': {
        desc: 'generate the dependency graph for the package(s)',
        parallel: true,
        options: {
          params: {
            optional: ['packageNames', 'distribution'],
          },
        },
      },
      'refrhash': {
        desc: 'refresh $hash entries of definitions',
        parallel: true,
      },
      'version': {
        desc: 'read and test the version of the package(s)',
        parallel: true,
        options: {
          params: {
            optional: ['packageNames'],
          },
        },
      },
      'gitMergeDefinitions': {
        desc: 'merge the package definitions with the appropriate versions',
        parallel: false,
      },
    },
  };
};
