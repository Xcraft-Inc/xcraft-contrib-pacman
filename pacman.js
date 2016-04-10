'use strict';

var path     = require ('path');
var async    = require ('async');
var _        = require ('lodash');
var clone    = require ('clone');
var traverse = require ('traverse');

var definition = require ('./lib/def.js');
var list       = require ('./lib/list.js');
var utils      = require ('./lib/utils.js');

var xUtils       = require ('xcraft-core-utils');
var xEnv         = require ('xcraft-core-env');

var cmd = {};


var depsPattern = '<-deps';
var extractPackages = function (packageRefs, response) {
  var results = [];
  var pkgs    = [];

  if (packageRefs) {
    packageRefs = packageRefs.replace (/,{2,}/g, ',')
                             .replace (/^,/, '')
                             .replace (/,$/, '');
  }

  var all = !packageRefs || !packageRefs.length;
  if (all) {
    pkgs = list.listProducts ();

    pkgs.forEach (function (item) {
      results.push (item.name);
    });
  } else {
    pkgs = packageRefs.split (',');

    var prev = null;
    pkgs.forEach (function (item) {
      if (!new RegExp (xUtils.regex.toRegexp (depsPattern)).test (item)) {
        prev = item;
        results = _.union (results, [item]);
        return;
      }

      /* Ignore the deps pattern if it's the first entry. */
      if (!prev) {
        return;
      }

      /* Section to extract all dependencies for the current package. */
      var def = null;
      var deps = {};
      try {
        def = definition.load (prev, null, response);
      } catch (ex) {
        return;
      }

      Object.keys (def.dependency).forEach (function (type) {
        if (def.dependency[type]) {
          var depsList = Object.keys (def.dependency[type]).join (',' + depsPattern + ',');
          depsList += ',' + depsPattern;

          /* Continue recursively for the dependencies of this dependency. */
          deps[type] = extractPackages (depsList, response);
          results = _.union (results, deps[type].list);
        }
      });

      prev = null;
    });
  }

  return {
    list: results,
    all:  all
  };
};

cmd.list = function (msg, response) {
  response.log.info ('list of all products');

  var list = require ('./lib/list.js');

  var results = list.listProducts (response);
  response.events.send ('pacman.list', results);
  response.events.send ('pacman.list.finished');
};

/**
 * Create a new package template or modify an existing package config file.
 *
 * @param {Object} msg
 */
cmd.edit = function (msg, response) {
  var wizard = clone (require ('./wizard.js'), false);
  /* replace all func by a promise */
  traverse (wizard).forEach (function (value) {
    if (this.key === 'xcraftCommands') {
      return;
    }
    if (typeof value === 'function') {
      this.update (`__begin__
        function (arg) {
          var done = this.async ();
          const cmd = 'wizard.${this.path[0]}.${wizard[this.path[0]][this.path[1]].name}.${this.key}';
          busClient.command.send (cmd, arg, null, function (err, res) {
            done (res.data);
          });
        }
      __end__`);
    }
  });

  msg.data.wizardImpl = JSON.stringify (wizard)
    .replace (/("__begin__|__end__")/g, '')
    .replace (/\\n[ ]*/g, '\n');

  var packageName = msg.data.packageName || '';
  msg.data.wizardAnswers = [];

  response.log.info ('create a new package: ' + packageName);

  try {
    response.command.send ('pacman.edit.header', msg.data);
  } catch (err) {
    response.log.err (err);
  }
};

cmd['edit.header'] = function (msg, response) {
  const pacmanConfig = require ('xcraft-core-etc') (null, response).load ('xcraft-contrib-pacman');

  /* The first question is the package's name, then we set the default value. */
  var wizard = {
    package: msg.data.packageName
  };

  var def = definition.load (msg.data.packageName, null, response);

  wizard.version          = def.version;
  wizard.tool             = def.distribution === pacmanConfig.pkgToolchainRepository;
  wizard.maintainerName   = def.maintainer.name;
  wizard.maintainerEmail  = def.maintainer.email;
  wizard.architecture     = def.architecture;
  wizard.descriptionBrief = def.description.brief;
  wizard.descriptionLong  = def.description.long;

  msg.data.wizardPath     = path.join (__dirname, 'wizard.js');
  msg.data.wizardName     = 'header';
  msg.data.wizardDefaults = wizard;

  /* Prepare for dependency wizard. */
  msg.data.idxDep   = 0;
  msg.data.idxRange = 0;
  msg.data.depType  = 'install';
  msg.data.nextStep = 'edit.data';

  msg.data.nextCommand = 'pacman.edit.askdep';

  response.events.send ('pacman.edit.added', msg.data);
  response.events.send ('pacman.edit.header.finished');
};

cmd['edit.askdep'] = function (msg, response) {
  var wizard = {};

  var wizardName = 'askdep/' + msg.data.depType;

  var def  = definition.load (msg.data.packageName, null, response);
  var keys = Object.keys (def.dependency[msg.data.depType]);

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

  msg.data.wizardName     = wizardName;
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.dependency';

  response.events.send ('pacman.edit.added', msg.data);
  response.events.send ('pacman.edit.askdep.finished');
};

cmd['edit.dependency'] = function (msg, response) {
  var wizard = {
    version: ''
  };

  if (msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasDependency === false) {
    cmd[msg.data.nextStep] (msg, response);
    response.events.send ('pacman.edit.dependency.finished');
    return;
  }

  var wizardName = 'dependency/' + msg.data.depType;

  var def  = definition.load (msg.data.packageName, null, response);
  var keys = Object.keys (def.dependency[msg.data.depType]);

  if (keys.length > msg.data.idxDep) {
    var key = keys[msg.data.idxDep];

    if (def.dependency[msg.data.depType][key].length > msg.data.idxRange) {
      wizard[wizardName]  = key;
      wizard.version      = def.dependency[msg.data.depType][key][msg.data.idxRange].version;
      wizard.architecture = def.dependency[msg.data.depType][key][msg.data.idxRange].architecture;
      msg.data.idxRange++;
    } else {
      msg.data.idxDep++;
    }
  }

  msg.data.wizardName     = wizardName;
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.askdep';

  response.events.send ('pacman.edit.added', msg.data);
  response.events.send ('pacman.edit.dependency.finished');
};

cmd['edit.data'] = function (msg, response) {
  var wizard = {};

  var def = definition.load (msg.data.packageName, null, response);

  wizard.uri                  = def.data.get.uri;
  wizard.uriRef               = def.data.get.ref;
  wizard.uriOut               = def.data.get.out;
  wizard.fileType             = def.data.type;
  wizard.configureCmd         = def.data.configure;
  wizard.rulesType            = def.data.rules.type;
  wizard.rulesLocation        = def.data.rules.location;
  wizard.rulesArgsPostinst    = def.data.rules.args.postinst;
  wizard.rulesArgsPrerm       = def.data.rules.args.prerm;
  wizard.rulesArgsMakeall     = def.data.rules.args.makeall;
  wizard.rulesArgsMakeinstall = def.data.rules.args.makeinstall;
  wizard.deployCmd            = def.data.deploy;
  wizard.registerPath         = def.data.env.path.join (',');
  wizard.registerLDPath       = def.data.env.ldpath.join (',');
  wizard.embedded             = def.data.embedded;
  if (def.data.runtime) {
    wizard.runtimeConfigureCmd = def.data.runtime.configure;
  }

  msg.data.wizardName     = 'data';
  msg.data.wizardDefaults = wizard;
  msg.data.idxEnv         = 0;

  /* Ask for build dependencies only with source packages. */
  if (msg.data.wizardAnswers.some (function (wizard) {
    return Object.keys (wizard).some (function (it) {
      return it === 'architecture' && wizard[it].some (function (arch) {
        return arch === 'source';
      });
    });
  })) {
    /* Prepare for dependency wizards. */
    msg.data.idxDep   = 0;
    msg.data.idxRange = 0;
    msg.data.depType  = 'build';
    msg.data.nextStep = 'edit.env';

    msg.data.nextCommand = 'pacman.edit.askdep';
  } else {
    msg.data.nextCommand = 'pacman.edit.env';
  }

  response.events.send ('pacman.edit.added', msg.data);
  response.events.send ('pacman.edit.data.finished');
};

cmd['edit.env'] = function (msg, response) {
  var wizard = {};

  /* Continue when the key is an empty string. */
  if ( msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasOwnProperty ('key') &&
      !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].key.length) {
    cmd[msg.data.nextStep] (msg, response);
    response.events.send ('pacman.edit.env.finished');
    return;
  }

  var def  = definition.load (msg.data.packageName, null, response);
  var keys = Object.keys (def.data.env.other);

  if (keys.length > msg.data.idxEnv) {
    var key = keys[msg.data.idxEnv];
    wizard.key   = key;
    wizard.value = def.data.env.other[key];
    msg.data.idxEnv++;
  }

  msg.data.wizardName     = 'env';
  msg.data.wizardDefaults = wizard;
  msg.data.nextStep       = 'edit.save';

  msg.data.nextCommand = 'pacman.edit.env';

  response.events.send ('pacman.edit.added', msg.data);
  response.events.send ('pacman.edit.env.finished');
};

cmd['edit.save'] = function (msg, response) {
  var create = require ('./lib/edit.js');

  var wizardAnswers = msg.data.wizardAnswers;

  create.pkgTemplate (wizardAnswers, response, function (wizardName, file) {
    msg.data.wizardName     = wizardName;
    msg.data.wizardDefaults = {};

    msg.data.chestFile = file;

    msg.data.nextCommand = 'pacman.edit.upload';

    response.events.send ('pacman.edit.added', msg.data);
  }, function (err, useChest) {
    if (err) {
      response.log.err (err);
    }
    response.events.send ('pacman.edit.save.finished');
    if (!useChest) {
      response.events.send ('pacman.edit.finished');
    }
  });
};

cmd['edit.upload'] = function (msg, response) {
  const chestConfig = require ('xcraft-core-etc') (null, response).load ('xcraft-contrib-chest');

  if (!chestConfig || !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].mustUpload) {
    response.events.send ('pacman.edit.upload.finished');
    response.events.send ('pacman.edit.finished');
    return;
  }

  response.log.info ('upload %s to chest://%s:%d',
                     msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath,
                     chestConfig.host,
                     chestConfig.port);

  response.events.subscribe ('chest.send.finished', function () {
    response.events.unsubscribe ('chest.send.finished');
    response.events.send ('pacman.edit.upload.finished');
    response.events.send ('pacman.edit.finished');
  });

  var chestMsg = {
    file: msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath
  };
  response.command.send ('chest.send', chestMsg);
};

/**
 * Make the Control file for WPKG by using a package config file.
 *
 * @param {Object} msg
 */
cmd.make = function (msg, response) {
  var make  = require ('./lib/make.js');

  var packageRefs      = null;
  var packageArgs      = {};
  var packageArgsOther = {};

  if (msg.data.packageArgs) {
    /* Retrieve the packageRef if available. */
    if (!/^p:/.test (msg.data.packageArgs[0])) {
      packageRefs = msg.data.packageArgs.shift ();
    }

    /* Transform all properties to a map. */
    msg.data.packageArgs.forEach (function (arg) {
      var match = arg.trim ().match (/^p:(?:([^:]*):)?([^=]*)[=](.*)/);
      if (match) {
        if (match[1]) {
          if (!packageArgs[match[1]]) {
            packageArgs[match[1]] = {};
          }
          packageArgs[match[1]][match[2]] = match[3];
        } else {
          packageArgsOther[match[2]] = match[3];
        }
      }
    });
  }

  response.log.verb ('list of overloaded properties: %s %s',
                     JSON.stringify (packageArgsOther, null, 2),
                     JSON.stringify (packageArgs, null, 2));

  var pkgs = extractPackages (packageRefs, response).list;
  var status = response.events.status.succeeded;

  var cleanArg = {};
  if (packageRefs) {
    cleanArg.packageNames = pkgs.join (',');
  }
  response.command.send ('pacman.clean', cleanArg, function (err) {
    if (err) {
      response.log.err (err);
      response.events.send ('pacman.make.finished');
      return;
    }

    async.eachSeries (pkgs, function (packageRef, callback) {
      var pkg = utils.parsePkgRef (packageRef);

      response.log.info ('make the wpkg package for ' + pkg.name + ' on architecture: ' + pkg.arch);

      var pkgArgs = packageArgsOther;
      if (packageArgs.hasOwnProperty (pkg.name)) {
        pkgArgs = packageArgs[pkg.name];
      }

      make.package (pkg.name, pkg.arch, pkgArgs, null, response, function (err) {
        if (err) {
          response.log.err (err.stack ? err.stack : err);
          status = response.events.status.failed;
        }
        callback ();
      });
    }, function () {
      response.events.send ('pacman.make.finished', status);
    });
  });
};

/**
 * Try to install the developement package.
 *
 * @param {Object} msg
 */
cmd.install = function * (msg, response) {
  const install = require ('./lib/install.js') (response);

  var pkgs = extractPackages (msg.data.packageRefs, response).list;
  var status = response.events.status.succeeded;

  for (const packageRef of pkgs) {
    try {
      yield install.package (packageRef, false);
      xEnv.devrootUpdate ();
    } catch (ex) {
      response.log.err (ex.stack || ex);
      status = response.events.status.failed;
    } finally {
      response.events.send ('pacman.install.finished', status);
    }
  }
};

/**
 * Try to reinstall the developement package.
 *
 * @param {Object} msg
 */
cmd.reinstall = function * (msg, response) {
  const install = require ('./lib/install.js') (response);

  var pkgs = extractPackages (msg.data.packageRefs, response).list;
  var status = response.events.status.succeeded;

  for (const packageRef of pkgs) {
    try {
      yield install.package (packageRef, true);
      xEnv.devrootUpdate ();
    } catch (ex) {
      response.log.err (ex.stack || ex);
      status = response.events.status.failed;
    } finally {
      response.events.send ('pacman.reinstall.finished', status);
    }
  }
};

/**
 * Test if a package is installed or published.
 *
 * @param {Object} msg
 */
cmd.status = function * (msg, response, next) {
  const install = require ('./lib/install.js') (response);
  const publish = require ('./lib/publish.js');

  var pkgs = extractPackages (msg.data.packageRefs, response).list;
  var status = response.events.status.succeeded;

  try {
    let installStatus;
    let publishStatus;

    for (const packageRef of pkgs) {
      const code = yield install.status (packageRef);
      installStatus = {
        packageRef: packageRef,
        installed:  !!code
      };

      const deb = yield publish.status (packageRef, null, response, next);
      publishStatus = {
        packageRef: packageRef,
        published:  deb
      };
    }

    const res = _.merge (installStatus, publishStatus);
    response.events.send ('pacman.status', res);
  } catch (ex) {
    response.log.err (ex.stack || ex);
    status = response.events.status.failed;
  } finally {
    response.events.send ('pacman.status.finished', status);
  }
};

/**
 * Try to compile the sources of a source package.
 *
 * @param {Object} msg
 */
cmd.build = function (msg, response) {
  var build = require ('./lib/build.js') (response);

  var pkgs = [null];

  var extractedPkgs = extractPackages (msg.data.packageRefs, response);
  if (!extractedPkgs.all) {
    pkgs = extractedPkgs.list;
  }

  var status = response.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    build.package (packageRef, function (err) {
      if (err) {
        response.log.err (err);
        status = response.events.status.failed;
      }
      callback ();
    });
  }, function () {
    response.events.send ('pacman.build.finished', status);
  });
};

/**
 * Try to remove the developement package.
 *
 * @param {Object} msg
 */
cmd.remove = function (msg, response) {
  var remove = require ('./lib/remove.js');

  var pkgs = extractPackages (msg.data.packageRefs, response).list;
  var status = response.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    remove.package (packageRef, response, function (err) {
      if (err) {
        response.log.err (err);
        status = response.events.status.failed;
      }
      xEnv.devrootUpdate ();
      callback ();
    });
  }, function () {
    response.events.send ('pacman.remove.finished', status);
  });
};

/**
 * Remove all the generated files from the temporary directory.
 *
 * @param {Object} msg
 */
cmd.clean = function (msg, response) {
  var clean = require ('./lib/clean.js');

  var pkgs = extractPackages (msg.data.packageNames, response).list;
  var status = response.events.status.succeeded;

  async.eachSeries (pkgs, function (packageName, callback) {
    clean.temp (packageName, response, function (err) {
      if (err) {
        response.log.err (err);
        status = response.events.status.failed;
      }
      callback ();
    });
  }, function () {
    response.events.send ('pacman.clean.finished', status);
  });
};

/**
 * Publish a package in a specified repository.
 *
 * @param {Object} msg
 */
cmd.publish = function (msg, response) {
  const publish = require ('./lib/publish.js');

  const pkgs = extractPackages (msg.data.packageRefs, response).list;
  let status = response.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    publish.add (packageRef, null, msg.data.outputRepository, response, function (err) {
      if (err) {
        response.log.err (err);
        status = response.events.status.failed;
      }
      callback ();
    });
  }, function () {
    response.events.send ('pacman.publish.finished', status);
  });
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  const xUtils = require ('xcraft-core-utils');
  return {
    handlers: cmd,
    rc: xUtils.json.fromFile (path.join (__dirname, './rc.json'))
  };
};
