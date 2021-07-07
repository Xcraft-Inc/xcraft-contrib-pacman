'use strict';

var path = require('path');
var _ = require('lodash');
const clc = require('cli-color');

const watt = require('gigawatts');
var definition = require('./lib/def.js');
var list = require('./lib/list.js');
var utils = require('./lib/utils.js');

var xUtils = require('xcraft-core-utils');
var xEnv = require('xcraft-core-env');
const xWizard = require('xcraft-core-wizard');
const xPlatform = require('xcraft-core-platform');

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
      results.push(item.name);
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
            var depsList = Object.keys(def.dependency[type]).join(
              ',' + depsPattern + ','
            );
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

  if (msg._ignoreOverwatch) {
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
    utils.errorReporting(resp)(data);
  }
});

cmd.list = function (msg, resp) {
  resp.log.info('list of all products');

  var list = require('./lib/list.js');

  var results = list.listProducts(resp);
  resp.events.send('pacman.list', results);
  resp.events.send(`pacman.list.${msg.id}.finished`);
};

cmd['list-status'] = function* (msg, resp, next) {
  const wpkg = require('xcraft-contrib-wpkg')(resp);
  let list = [];

  try {
    const {arch = xPlatform.getToolchainArch()} = msg.data;
    const {pattern} = msg.data;
    const distribution = getDistribution(msg);

    list = yield wpkg.list(arch, distribution, pattern, next);
  } catch (ex) {
    resp.events.send(`pacman.list-status.${msg.id}.error`, ex);
  } finally {
    resp.events.send(`pacman.list-status.${msg.id}.finished`, list);
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
    resp.events.send(`pacman.search.${msg.id}.error`, ex);
  } finally {
    resp.events.send(`pacman.search.${msg.id}.finished`, list);
  }
};

/**
 * Create a new package template or modify an existing package config file.
 *
 * @param {Object} msg
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
 * @param {Object} msg
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
        match = arg.trim().match(/^d:([a-z]+)/);
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

  /* FIXME: replace pacmanConfig.pkgToolchainRepository by distribution
   *        and by default it should make the package for all distributions
   *        (in the case of non-source packages)
   */
  const pkgs = extractPackages(
    packageRefs,
    pacmanConfig.pkgToolchainRepository,
    resp
  ).list;
  let status = resp.events.status.succeeded;

  const cleanArg = {};
  if (packageRefs) {
    cleanArg.packageNames = pkgs.join(',');
    /* FIXME: replace pacmanConfig.pkgToolchainRepository by distribution
     *        and by default it should clean the package for all distributions
     *        (in the case of non-source packages)
     */
    cleanArg.distribution = pacmanConfig.pkgToolchainRepository;
  }

  try {
    yield resp.command.send('pacman.clean', cleanArg, next);
  } catch (ex) {
    resp.log.err(ex.stack || ex);
    resp.events.send(`pacman.make.${msg.id}.finished`);
    return;
  }

  yield wrapOverwatch(
    function* () {
      for (const packageRef of pkgs) {
        const pkg = utils.parsePkgRef(packageRef);
        pkg.name = pkg.name.replace(/-dev$/, '');

        resp.log.info(
          'make the wpkg package for ' +
            pkg.name +
            ' on architecture: ' +
            pkg.arch
        );

        let pkgArgs = packageArgsOther;
        if (packageArgs.hasOwnProperty(pkg.name)) {
          pkgArgs = packageArgs[pkg.name];
        }

        try {
          yield make.package(pkg.name, pkg.arch, pkgArgs, null);
        } catch (ex) {
          resp.log.err(ex.stack || ex);
          status = resp.events.status.failed;
        }
      }
    },
    msg,
    resp
  );

  resp.events.send(`pacman.make.${msg.id}.finished`, status);
};

function* install(msg, resp, reinstall = false) {
  const install = require('./lib/install.js')(resp);

  const subCmd = reinstall ? 'reinstall' : 'install';

  const {prodRoot} = msg.data;

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  var status = resp.events.status.succeeded;

  for (const packageRef of pkgs) {
    try {
      yield install.package(packageRef, distribution, prodRoot, reinstall);
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
 * @param {Object} msg
 */
cmd.install = function* (msg, resp) {
  yield* install(msg, resp, false);
};

/**
 * Try to reinstall the developement package.
 *
 * @param {Object} msg
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
 * @param {Object} msg
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
 * Try to compile the sources of a source package.
 *
 * @param {Object} msg
 */
cmd.build = function* (msg, resp, next) {
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

  resp.events.send(`pacman.build.${msg.id}.finished`, status);
};

cmd['zero-build'] = function* (msg, resp) {
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  const build = require('./lib/build.js')(resp);

  const distribution = getDistribution(msg);
  process.env.PEON_DEBUG_ENV = '1';

  try {
    yield build.package(msg.data.packageRef, distribution);
    resp.log.info(
      clc.blueBright.bold(
        `Go to the source directory of ${msg.data.packageRef} in the ${
          distribution || pacmanConfig.pkgToolchainRepository
        } distribution.\n` +
          `A 'source-debug-env.sh' script can be used in order to manually load the build environment.`
      ) + ' '
    );
    resp.events.send(`pacman.zero-build.${msg.id}.finished`);
  } catch (ex) {
    resp.log.err(ex.stack || ex.message || ex);
    resp.events.send(`pacman.zero-build.${msg.id}.error`);
  } finally {
    delete process.env.PEON_DEBUG_ENV;
  }
};

/**
 * Try to remove the developement package.
 *
 * @param {Object} msg
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
 * Remove all the generated files from the temporary directory.
 *
 * @param {Object} msg
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
 * @param {Object} msg
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
 * @param {Object} msg
 */
cmd.unpublish = function* (msg, resp) {
  const publish = require('./lib/publish.js')(resp);

  const {list, distribution} = extractPackages(
    msg.data.packageRefs,
    getDistribution(msg),
    resp
  );
  const pkgs = list;
  let status = resp.events.status.succeeded;

  /* Try to unpublish most of packages; continue with the next on error. */
  for (const [idx, packageRef] of pkgs.entries()) {
    try {
      yield publish.remove(
        packageRef,
        null,
        distribution,
        idx === pkgs.length - 1
      );
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.unpublish.${msg.id}.finished`, status);
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
  const clc = require('cli-color');
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

  const V = clc.greenBright('✓');
  const X = clc.redBright('⨯');
  const H = clc.magentaBright('?');

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

  for (const [, packageRef] of list.entries()) {
    try {
      const pkg = utils.parsePkgRef(packageRef);
      const packageDef = definition.load(pkg.name, {}, resp, null);
      const getObj = utils.makeGetObj(clone(packageDef));
      const type = xPeonUtils.typeFromUri(getObj);
      if (!type) {
        continue;
      }

      const versions = [];
      versions.push(packageDef.$version);

      if (getObj.uri !== packageDef.data.get.uri) {
        versions.push(semver.inc(versions[0], 'patch'));
        versions.push(semver.inc(versions[0], 'minor'));
        versions.push(semver.inc(versions[0], 'major'));
      }

      for (const version of versions) {
        if (!version) {
          continue;
        }
        packageDef.$version = version;
        const getObj = utils.makeGetObj(clone(packageDef));
        const status = yield checkVersion(type, getObj.uri);

        if (version === versions[0]) {
          resp.log.info(
            `[${status}] ${type.toUpperCase()}${new Array(5 - type.length).join(
              ' '
            )} ${pkg.name} v${version}`
          );
        } else if (version !== versions[versions.length - 1]) {
          resp.log.info(` |- [${status}] v${version}`);
        } else {
          resp.log.info(` '- [${status}] v${version}`);
        }
      }
    } catch (ex) {
      resp.log.err(ex.stack || ex);
      status = resp.events.status.failed;
    }
  }

  resp.events.send(`pacman.version.${msg.id}.finished`, status);
};

cmd['_postload'] = function* (msg, resp, next) {
  try {
    yield resp.command.send('overwatch.init', null, next);
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
        desc: 'list all available packages',
      },
      'list-status': {
        parallel: true,
        desc: 'list status of installed packages',
        options: {
          params: {
            optional: ['pattern', 'distribution', 'arch'],
          },
        },
      },
      'search': {
        parallel: true,
        desc: 'search files installed packages',
        options: {
          params: {
            required: 'pattern',
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
            optional: ['packageRefs', 'distribution', 'prodRoot'],
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
      'build': {
        desc: 'compile a source package',
        options: {
          params: {
            optional: ['packageRefs', 'distribution'],
          },
        },
      },
      'zero-build': {
        desc: 'prepare a package for building (without starting the build)',
        options: {
          params: {
            required: 'packageRef',
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
      'clean': {
        desc: 'remove the temporary package files',
        options: {
          params: {
            optional: ['packageNames', 'distribution'],
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
      'version': {
        desc: 'read and test the version of the package(s)',
        parallel: true,
        options: {
          params: {
            optional: ['packageNames'],
          },
        },
      },
    },
  };
};
