'use strict';

var moduleName = 'pacman';

var path  = require ('path');
var async = require ('async');

var definition = require ('./lib/definition.js');
var list       = require ('./lib/list.js');

var xPath        = require ('xcraft-core-path');
var xLog         = require ('xcraft-core-log') (moduleName);
var busClient    = require ('xcraft-core-busclient').global;
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

var cmd = {};


var extractPackages = function (packageRefs) {
  if (packageRefs) {
    return packageRefs.split (',');
  }

  var pkgs    = list.listProducts ();
  var results = [];

  pkgs.forEach (function (item) {
    results.push (item.name);
  });

  return results;
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

  try {
    var def = definition.load (msg.data.packageName);

    wizard.version          = def.version;
    wizard.tool             = def.distribution === pacmanConfig.pkgToolchainRepository;
    wizard.maintainerName   = def.maintainer.name;
    wizard.maintainerEmail  = def.maintainer.email;
    wizard.architecture     = def.architecture;
    wizard.architectureHost = def.architectureHost;
    wizard.descriptionBrief = def.description.brief;
    wizard.descriptionLong  = def.description.long;
  } catch (err) {}

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

  try {
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
  } catch (err) {}

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

  try {
    var def  = definition.load (msg.data.packageName);
    var keys = Object.keys (def.dependency[msg.data.depType]);

    if (keys.length > msg.data.idxDep) {
      var key = keys[msg.data.idxDep];

      if (def.dependency[msg.data.depType][key].length > msg.data.idxRange) {
        wizard[wizardName] = key;
        wizard.version     = def.dependency[msg.data.depType][key][msg.data.idxRange];
        msg.data.idxRange++;
      } else {
        msg.data.idxDep++;
      }
    }
  } catch (err) {}

  msg.data.wizardName     = wizardName;
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.askdep';
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.data'] = function (msg) {
  var wizard = {};

  try {
    var def = definition.load (msg.data.packageName);

    wizard.uri               = def.data.get.uri;
    wizard.uriRef            = def.data.get.ref;
    wizard.uriOut            = def.data.get.out;
    wizard.fileType          = def.data.type;
    wizard.configureCmd      = def.data.configure;
    wizard.rulesType         = def.data.rules.type;
    wizard.rulesLocation     = def.data.rules.location;
    wizard.rulesArgsPostinst = def.data.rules.args[pacmanConfig.pkgPostinst];
    wizard.rulesArgsPrerm    = def.data.rules.args[pacmanConfig.pkgPrerm];
    wizard.rulesArgsMakeall  = def.data.rules.args[pacmanConfig.pkgMakeall];
    wizard.registerPath      = def.data.path[0];
    wizard.embedded          = def.data.embedded;
  } catch (err) {}

  msg.data.wizardName     = 'data';
  msg.data.wizardDefaults = wizard;

  /* Ask for build dependencies only with source packages. */
  if (msg.data.wizardAnswers.some (function (wizard) {
    return Object.keys (wizard).some (function (it) {
      return it === 'architecture' && wizard[it].some (function (arch) {
        return arch === 'source';
      });
    });
  })) {
    /* Prepare for dependency wizard. */
    msg.data.idxDep   = 0;
    msg.data.idxRange = 0;
    msg.data.depType  = 'build';
    msg.data.nextStep = 'edit.save';

    msg.data.nextCommand = 'pacman.edit.askdep';
  } else {
    msg.data.nextCommand = 'pacman.edit.save';
  }

  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.save'] = function (msg) {
  var create = require ('./lib/edit.js');

  var wizardAnswers = msg.data.wizardAnswers;
  xLog.verb ('JSON output for pre-package definition:\n' +
             JSON.stringify (wizardAnswers, null, '  '));

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

  xLog.info ('upload %s to chest://%s:%d/%s',
               msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath,
               chestConfig.host,
               chestConfig.port,
               msg.data.chestFile);

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
  var utils = require ('./lib/utils.js');
  var make  = require ('./lib/make.js');

  var packageRefs = null;
  var packageArgs = {};

  if (msg.data.packageArgs) {
    /* Retrieve the packageRef if available. */
    if (!/^p:/.test (msg.data.packageArgs[0])) {
      packageRefs = msg.data.packageArgs.shift ();
    }

    /* Transform all properties to a map. */
    msg.data.packageArgs.forEach (function (arg) {
      var match = arg.trim ().match (/^p:([^=]*)[=](.*)/);
      if (match) {
        packageArgs[match[1]] = match[2];
      }
    });
  }

  var pkgs = extractPackages (packageRefs);

  async.eachSeries (pkgs, function (packageRef, callback) {
    var pkg = utils.parsePkgRef (packageRef);

    xLog.info ('make the wpkg package for ' + (pkg.name || 'all') + ' on architecture: ' + pkg.arch);
    xLog.verb ('list of overloaded properties: %s', JSON.stringify (packageArgs));

    busClient.command.send ('pacman.clean', {
      packageNames: pkg.name
    }, function (err) {
      if (err) {
        xLog.err (err);
        busClient.events.send ('pacman.make.finished');
        return;
      }

      if (!pkg.name) {
        var xFs   = require ('xcraft-core-fs');

        /* FIXME: use pacman.list */
        var packages = xFs.lsdir (xcraftConfig.pkgProductsRoot);

        /* Loop for each package available in the products directory. */
        async.eachSeries (packages, function (packageName, callback) {
          make.package (packageName, pkg.arch, packageArgs, callback);
        }, function () {
          busClient.events.send ('pacman.make.finished');
        });
      } else {
        make.package (pkg.name, pkg.arch, packageArgs, function (err) {
          if (err) {
            xLog.err (err.stack ? err.stack : err);
          }
          callback ();
        });
      }
    });
  }, function () {
    busClient.events.send ('pacman.make.finished');
  });
};

/**
 * Try to install the developement package.
 *
 * @param {Object} msg
 */
cmd.install = function (msg) {
  var install = require ('./lib/install.js');

  var pkgs = extractPackages (msg.data.packageRefs);

  async.eachSeries (pkgs, function (packageRef, callback) {
    install.package (packageRef, false, function (err) {
      if (err) {
        xLog.err (err);
      }
      xPath.devrootUpdate ();
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.install.finished');
  });
};

/**
 * Try to reinstall the developement package.
 *
 * @param {Object} msg
 */
cmd.reinstall = function (msg) {
  var install = require ('./lib/install.js');

  var pkgs = extractPackages (msg.data.packageRefs);

  async.eachSeries (pkgs, function (packageRef, callback) {
    install.package (packageRef, true, function (err) {
      if (err) {
        xLog.err (err);
      }
      xPath.devrootUpdate ();
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.reinstall.finished');
  });
};

/**
 * Test if a package is installed.
 *
 * @param {Object} msg
 */
cmd.status = function (msg) {
  var install = require ('./lib/install.js');

  var pkgs = extractPackages (msg.data.packageRefs);

  async.eachSeries (pkgs, function (packageRef, callback) {
    install.status (packageRef, function (err, code) {
      if (err) {
        xLog.err (err);
      }

      var status = {
        installed: !!code
      };

      busClient.events.send ('pacman.status', status);
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.status.finished');
  });
};

/**
 * Try to compile the sources of a source package.
 *
 * @param {Object} msg
 */
cmd.build = function (msg) {
  var build = require ('./lib/build.js');

  var pkgs = extractPackages (msg.data.packageRefs);

  async.eachSeries (pkgs, function (packageRef, callback) {
    build.package (packageRef, function (err) {
      if (err) {
        xLog.err (err);
      }
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.build.finished');
  });
};

/**
 * Try to remove the developement package.
 *
 * @param {Object} msg
 */
cmd.remove = function (msg) {
  var remove = require ('./lib/remove.js');

  var pkgs = extractPackages (msg.data.packageRefs);

  async.eachSeries (pkgs, function (packageRef, callback) {
    remove.package (packageRef, function (err) {
      if (err) {
        xLog.err (err);
      }
      xPath.devrootUpdate ();
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.remove.finished');
  });
};

/**
 * Remove all the generated files from the temporary directory.
 *
 * @param {Object} msg
 */
cmd.clean = function (msg) {
  var clean = require ('./lib/clean.js');

  var pkgs = extractPackages (msg.data.packageNames);

  async.eachSeries (pkgs, function (packageName, callback) {
    clean.temp (packageName, function (err) {
      if (err) {
        xLog.err (err);
      }
      callback ();
    });
  }, function () {
    busClient.events.send ('pacman.clean.finished');
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

exports.xcraftConfig = [{
  type: 'checkbox',
  name: 'architectures',
  message: 'supported architectures',
  choices: function () {
    var list = [];

    exports.xcraftConfig[0].default.forEach (function (arch) {
      list.push ({
        name: arch,
        checked: true
      });
    });

    return list;
  },
  default: [
    'mswindows-i386',
    'mswindows-amd64',
    'linux-i386',
    'linux-amd64',
    'darwin-i386',
    'darwin-amd64',
    'solaris-i386',
    'solaris-amd64',
    'freebsd-i386',
    'freebsd-amd64'
  ]
}, {
  type: 'input',
  name: 'pkgCfgFileName',
  message: 'config file name for wpkg definitions',
  default: 'config.yaml'
}, {
  type: 'input',
  name: 'pkgScript',
  message: 'template name for wpkg scripts',
  default: 'script'
}, {
  type: 'input',
  name: 'pkgPostinst',
  message: 'postinst wpkg script name',
  default: 'postinst'
}, {
  type: 'input',
  name: 'pkgPrerm',
  message: 'prerm wpkg script name',
  default: 'prerm'
}, {
  type: 'input',
  name: 'pkgMakeall',
  message: 'make all script name',
  default: 'makeall'
}, {
  type: 'input',
  name: 'pkgWPKG',
  message: 'wpkg directory for packages',
  default: 'WPKG'
}, {
  type: 'input',
  name: 'pkgToolchainRepository',
  message: 'toolchain repository path',
  default: 'toolchain/'
}, {
  type: 'input',
  name: 'pkgProductsRepository',
  message: 'products repository path',
  default: 'products/'
}, {
  type: 'input',
  name: 'pkgIndex',
  message: 'index file for wpkg repositories',
  default: 'index.tar.gz'
}, {
  type: 'input',
  name: 'stamps',
  message: 'location for build stamps',
  default: './var/xcraft-contrib-pacman/'
}];
