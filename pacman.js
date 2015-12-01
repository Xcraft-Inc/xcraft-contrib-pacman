'use strict';

var moduleName = 'pacman';

var path     = require ('path');
var async    = require ('async');
var _        = require ('lodash');
var clone    = require ('clone');
var traverse = require ('traverse');

var definition = require ('./lib/def.js');
var list       = require ('./lib/list.js');
var utils      = require ('./lib/utils.js');

var xEnv         = require ('xcraft-core-env');
var xLog         = require ('xcraft-core-log') (moduleName);
var busClient    = require ('xcraft-core-busclient').getGlobal ();
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

var cmd = {};


var depsPattern = '<-deps';
var extractPackages = function (packageRefs) {
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
      if (!new RegExp (utils.toRegexp (depsPattern)).test (item)) {
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
        def = definition.load (prev);
      } catch (ex) {
        return;
      }

      Object.keys (def.dependency).forEach (function (type) {
        if (def.dependency[type]) {
          var depsList = Object.keys (def.dependency[type]).join (',' + depsPattern + ',');
          depsList += ',' + depsPattern;

          /* Continue recursively for the dependencies of this dependency. */
          deps[type] = extractPackages (depsList);
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

cmd.list = function () {
  xLog.info ('list of all products');

  var list = require ('./lib/list.js');

  var results = list.listProducts ();
  busClient.events.send ('pacman.list', results);
  busClient.events.send ('pacman.list.finished');
};

/**
 * Create a new package template or modify an existing package config file.
 *
 * @param {Object} msg
 */
cmd.edit = function (msg) {
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
          busClient.command.send (cmd, arg, function (err, res) {
            done (res.data);
          });
        }
      __end__`);
    }
  });

  msg.data.wizardImpl = JSON.stringify (wizard)
    .replace (/"__begin__/g, '')
    .replace (/__end__"/g, '')
    .replace (/\\n/g, '\n');

  var packageName = msg.data.packageName || '';
  msg.data.wizardAnswers = [];

  xLog.info ('create a new package: ' + packageName);

  try {
    busClient.command.send ('pacman.edit.header', msg.data);
  } catch (err) {
    xLog.err (err);
  }
};

cmd['edit.header'] = function (msg) {
  /* The first question is the package's name, then we set the default value. */
  var wizard = {
    package: msg.data.packageName
  };

  var def = definition.load (msg.data.packageName);

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
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.askdep'] = function (msg) {
  var wizard = {};

  var wizardName = 'askdep/' + msg.data.depType;

  var def  = definition.load (msg.data.packageName);
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
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.dependency'] = function (msg) {
  var wizard = {
    version: ''
  };

  if (msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasDependency === false) {
    cmd[msg.data.nextStep] (msg);
    return;
  }

  var wizardName = 'dependency/' + msg.data.depType;

  var def  = definition.load (msg.data.packageName);
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
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.data'] = function (msg) {
  var wizard = {};

  var def = definition.load (msg.data.packageName);

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

  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.env'] = function (msg) {
  var wizard = {};

  /* Continue when the key is an empty string. */
  if ( msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasOwnProperty ('key') &&
      !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].key.length) {
    cmd[msg.data.nextStep] (msg);
    return;
  }

  var def  = definition.load (msg.data.packageName);
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
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.save'] = function (msg) {
  var create = require ('./lib/edit.js');

  var wizardAnswers = msg.data.wizardAnswers;

  create.pkgTemplate (wizardAnswers, function (wizardName, file) {
    msg.data.wizardName     = wizardName;
    msg.data.wizardDefaults = {};

    msg.data.chestFile = file;

    msg.data.nextCommand = 'pacman.edit.upload';
    busClient.events.send ('pacman.edit.added', msg.data);
  }, function (err, useChest) {
    if (err) {
      xLog.err (err);
    }
    if (!useChest) {
      busClient.events.send ('pacman.edit.finished');
    }
  });
};

cmd['edit.upload'] = function (msg) {
  var chestConfig = require ('xcraft-core-etc').load ('xcraft-contrib-chest');

  if (!chestConfig || !msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].mustUpload) {
    busClient.events.send ('pacman.edit.finished');
    return;
  }

  xLog.info ('upload %s to chest://%s:%d',
               msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath,
               chestConfig.host,
               chestConfig.port);

  busClient.events.subscribe ('chest.send.finished', function () {
    busClient.events.unsubscribe ('chest.send.finished');
    busClient.events.send ('pacman.edit.finished');
  });

  var chestMsg = {
    file: msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath
  };
  busClient.command.send ('chest.send', chestMsg);
};

/**
 * Make the Control file for WPKG by using a package config file.
 *
 * @param {Object} msg
 */
cmd.make = function (msg) {
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
          packageArgsOther = {};
          packageArgsOther[match[2]] = match[3];
        }
      }
    });
  }

  xLog.verb ('list of overloaded properties: %s %s',
             JSON.stringify (packageArgsOther, null, 2),
             JSON.stringify (packageArgs, null, 2));

  var pkgs = extractPackages (packageRefs).list;
  var status = busClient.events.status.succeeded;

  var cleanArg = {};
  if (packageRefs) {
    cleanArg.packageNames = pkgs.join (',');
  }
  busClient.command.send ('pacman.clean', cleanArg, function (err) {
    if (err) {
      xLog.err (err);
      busClient.events.send ('pacman.make.finished');
      return;
    }

    async.eachSeries (pkgs, function (packageRef, callback) {
      var pkg = utils.parsePkgRef (packageRef);

      xLog.info ('make the wpkg package for ' + pkg.name + ' on architecture: ' + pkg.arch);

      var pkgArgs = packageArgsOther;
      if (packageArgs.hasOwnProperty (pkg.name)) {
        pkgArgs = packageArgs[pkg.name];
      }

      make.package (pkg.name, pkg.arch, pkgArgs, function (err) {
        if (err) {
          xLog.err (err.stack ? err.stack : err);
          status = busClient.events.status.failed;
        }
        callback ();
      });
    }, function () {
      busClient.events.send ('pacman.make.finished', status);
    });
  });
};

/**
 * Try to install the developement package.
 *
 * @param {Object} msg
 */
cmd.install = function (msg) {
  var install = require ('./lib/install.js');

  var pkgs = extractPackages (msg.data.packageRefs).list;
  var status = busClient.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    install.package (packageRef, false, function (err) {
      if (err) {
        xLog.err (err);
        status = busClient.events.status.failed;
      }
      xEnv.devrootUpdate ();
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.install.finished', status);
  });
};

/**
 * Try to reinstall the developement package.
 *
 * @param {Object} msg
 */
cmd.reinstall = function (msg) {
  var install = require ('./lib/install.js');

  var pkgs = extractPackages (msg.data.packageRefs).list;
  var status = busClient.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    install.package (packageRef, true, function (err) {
      if (err) {
        xLog.err (err);
        status = busClient.events.status.failed;
      }
      xEnv.devrootUpdate ();
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.reinstall.finished', status);
  });
};

/**
 * Test if a package is installed.
 *
 * @param {Object} msg
 */
cmd.status = function (msg) {
  var install = require ('./lib/install.js');

  var pkgs = extractPackages (msg.data.packageRefs).list;
  var status = busClient.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    install.status (packageRef, function (err, code) {
      if (err) {
        xLog.err (err);
        status = busClient.events.status.failed;
      }

      var result = {
        packageRef: packageRef,
        installed:  !!code
      };

      busClient.events.send ('pacman.status', result);
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.status.finished', status);
  });
};

/**
 * Try to compile the sources of a source package.
 *
 * @param {Object} msg
 */
cmd.build = function (msg) {
  var build = require ('./lib/build.js');

  var pkgs = [null];

  var extractedPkgs = extractPackages (msg.data.packageRefs);
  if (!extractedPkgs.all) {
    pkgs = extractedPkgs.list;
  }

  var status = busClient.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    build.package (packageRef, function (err) {
      if (err) {
        xLog.err (err);
        status = busClient.events.status.failed;
      }
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.build.finished', status);
  });
};

/**
 * Try to remove the developement package.
 *
 * @param {Object} msg
 */
cmd.remove = function (msg) {
  var remove = require ('./lib/remove.js');

  var pkgs = extractPackages (msg.data.packageRefs).list;
  var status = busClient.events.status.succeeded;

  async.eachSeries (pkgs, function (packageRef, callback) {
    remove.package (packageRef, function (err) {
      if (err) {
        xLog.err (err);
        status = busClient.events.status.failed;
      }
      xEnv.devrootUpdate ();
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.remove.finished', status);
  });
};

/**
 * Remove all the generated files from the temporary directory.
 *
 * @param {Object} msg
 */
cmd.clean = function (msg) {
  var clean = require ('./lib/clean.js');

  var pkgs = extractPackages (msg.data.packageNames).list;
  var status = busClient.events.status.succeeded;

  async.eachSeries (pkgs, function (packageName, callback) {
    clean.temp (packageName, function (err) {
      if (err) {
        xLog.err (err);
        status = busClient.events.status.failed;
      }
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.clean.finished', status);
  });
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: path.join (__dirname, './rc.json')
  };
};
