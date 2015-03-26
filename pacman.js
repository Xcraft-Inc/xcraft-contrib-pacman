'use strict';

var moduleName = 'pacman';

var path = require ('path');

var definition = require ('./lib/definition.js');

var xPath        = require ('xcraft-core-path');
var xLog         = require ('xcraft-core-log') (moduleName);
var busClient    = require ('xcraft-core-busclient');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

var cmd = {};

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

  msg.data.idxDep   = 0;
  msg.data.idxRange = 0;

  msg.data.nextCommand = 'pacman.edit.askdep';
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.askdep'] = function (msg) {
  var wizard = {};

  try {
    var def  = definition.load (msg.data.packageName);
    var keys = Object.keys (def.dependency);

    if (keys.length > msg.data.idxDep) {
      var key = keys[msg.data.idxDep];

      if (def.dependency[key].length > msg.data.idxRange) {
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

  msg.data.wizardName     = 'askdep';
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.dependency';
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.dependency'] = function (msg) {
  var wizard = {};

  if (msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].hasDependency === false) {
    cmd['edit.data'] (msg);
    return;
  }

  try {
    var def  = definition.load (msg.data.packageName);
    var keys = Object.keys (def.dependency);

    if (keys.length > msg.data.idxDep) {
      var key = keys[msg.data.idxDep];

      if (def.dependency[key].length > msg.data.idxRange) {
        var wizardFile = require ('./wizard.js');

        wizard.dependency = wizardFile.dependency[0].choices ().indexOf (key);
        wizard.version    = def.dependency[key][msg.data.idxRange];
        msg.data.idxRange++;
      } else {
        msg.data.idxDep++;
      }
    }
  } catch (err) {}

  msg.data.wizardName     = 'dependency';
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.askdep';
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.data'] = function (msg) {
  var wizard = {};

  try {
    var def = definition.load (msg.data.packageName);

    wizard.uri               = def.data.uri;
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

  msg.data.nextCommand = 'pacman.edit.save';
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.save'] = function (msg) {
  var create = require ('./lib/create.js');

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

  var packageRef = msg.data.packageRef || '';
  var pkg = utils.parsePkgRef (packageRef);

  xLog.info ('make the wpkg package for ' + (pkg.name || 'all') + ' on architecture: ' + pkg.arch);

  /* TODO: make only when the source has changed (make-like behaviour) */
  if (!pkg.name) {
    var async = require ('async');
    var xFs   = require ('xcraft-core-fs');

    /* FIXME: use pacman.list */
    var packages = xFs.lsdir (xcraftConfig.pkgProductsRoot);

    /* Loop for each package available in the products directory. */
    async.eachSeries (packages, function (packageName, callback) {
      make.package (packageName, pkg.arch, callback);
    }, function () {
      busClient.events.send ('pacman.make.finished');
    });
  } else {
    make.package (pkg.name, pkg.arch, function (err) {
      if (err) {
        xLog.err (err);
      }
      busClient.events.send ('pacman.make.finished');
    });
  }
};

/**
 * Try to install the developement package.
 *
 * @param {Object} msg
 */
cmd.install = function (msg) {
  var packageRef = msg.data.packageRef || '';
  xLog.info ('install development package: ' + packageRef);

  var cmd = require ('./lib/cmd.js');

  cmd.install (packageRef, function (err) {
    if (err) {
      xLog.err (err);
    }
    xPath.devrootUpdate ();
    busClient.events.send ('pacman.install.finished');
  });
};

/**
 * Try to compile the sources of a source package.
 *
 * @param {Object} msg
 */
cmd.build = function (msg) {
  var packageRef = msg.data.packageRef || '';
  xLog.info ('compile a development package: ' + packageRef);

  var build = require ('./lib/build.js');

  build.package (packageRef, function (err) {
    if (err) {
      xLog.err (err);
    }
    busClient.events.send ('pacman.build.finished');
  });
};

/**
 * Try to remove the developement package.
 *
 * @param {Object} msg
 */
cmd.remove = function (msg) {
  var packageRef = msg.data.packageRef || '';
  xLog.info ('remove development package: ' + packageRef);

  var cmd = require ('./lib/cmd.js');

  cmd.remove (packageRef, function (err) {
    if (err) {
      xLog.err (err);
    }
    xPath.devrootUpdate ();
    busClient.events.send ('pacman.remove.finished');
  });
};

/**
 * Remove all the generated files.
 */
cmd.clean = function () {
  var xFs = require ('xcraft-core-fs');

  xLog.info ('clean all generated files');

  xLog.verb ('delete ' + xcraftConfig.pkgTargetRoot);
  xFs.rm (xcraftConfig.pkgTargetRoot);

  xLog.verb ('delete ' + xcraftConfig.pkgDebRoot);
  xFs.rm (xcraftConfig.pkgDebRoot);

  xFs.ls (xcraftConfig.tempRoot, /^(?!.*\.gitignore)/).forEach (function (file) {
    file = path.join (xcraftConfig.tempRoot, file);
    xLog.verb ('delete ' + file);

    xFs.rm (file);
  });

  xPath.devrootUpdate ();
  busClient.events.send ('pacman.clean.finished');
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
  name: 'pkgRepository',
  message: 'toolchain repository path',
  default: 'toolchain/'
}, {
  type: 'input',
  name: 'pkgIndex',
  message: 'index file for wpkg repositories',
  default: 'index.tar.gz'
}];

/**
 * Publish commands for std module exports.
 */
var main = function () {
  Object.keys (cmd).forEach (function (action) {
    exports[action] = cmd[action];
  });
};

main ();
