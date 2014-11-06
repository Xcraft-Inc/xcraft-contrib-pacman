'use strict';

/* ᗤ <- pacman ? */
var moduleName = 'pacman';

var path     = require ('path');

var pkgCreate     = require ('./pkgCreate.js');
var pkgDefinition = require ('./pkgDefinition.js');
var zogLog        = require ('xcraft-core-log') (moduleName);
var busClient     = require ('xcraft-core-busclient');
var zogPlatform   = require ('xcraft-core-platform');
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');

var cmd = {};

cmd.list = function () {
  zogLog.info ('list of all products');

  var pkgList = require ('./pkgList.js');

  var list = pkgList.listProducts ();
  busClient.events.send ('pacman.list', list);
  busClient.events.send ('pacman.list.finished');
};

/**
 * Create a new package template or modify an existing package config file.
 * @param {Object} msg
 */
cmd.edit = function (msg) {
  var packageName = msg.data.packageName;
  msg.data.wizardAnswers = [];

  zogLog.info ('create a new package: ' + packageName);

  try {
    busClient.command.send ('pacman.edit.header', msg.data);
  } catch (err) {
    zogLog.err (err);
  }
};

cmd['edit.header'] = function (msg) {
  /* The first question is the package's name, then we set the default value. */
  var wizard = {
    package: msg.data.packageName
  };

  try {
    var def = pkgDefinition.load (msg.data.packageName);

    wizard.version          = def.version;
    wizard.maintainerName   = def.maintainer.name;
    wizard.maintainerEmail  = def.maintainer.email;
    wizard.architecture     = def.architecture;
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
    var def  = pkgDefinition.load (msg.data.packageName);
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
    var def  = pkgDefinition.load (msg.data.packageName);
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
    var def = pkgDefinition.load (msg.data.packageName);

    wizard.uri              = def.data.uri;
    wizard.fileType         = def.data.type;
    wizard.rulesType        = def.data.rules.type;
    wizard.rulesLocation    = def.data.rules.location;
    wizard.rulesArgsInstall = def.data.rules.args.install;
    wizard.rulesArgsRemove  = def.data.rules.args.remove;
    wizard.embedded         = def.data.embedded;
  } catch (err) {}

  msg.data.wizardName     = 'data';
  msg.data.wizardDefaults = wizard;

  msg.data.nextCommand = 'pacman.edit.save';
  busClient.events.send ('pacman.edit.added', msg.data);
};

cmd['edit.save'] = function (msg) {
  var wizardAnswers  = msg.data.wizardAnswers;
  zogLog.verb ('JSON output for pre-package definition:\n' +
               JSON.stringify (wizardAnswers, null, '  '));

  pkgCreate.pkgTemplate (wizardAnswers, function (wizardName, file) {
    msg.data.wizardName     = wizardName;
    msg.data.wizardDefaults = {};

    msg.data.chestFile = file;

    msg.data.nextCommand = 'pacman.edit.upload';
    busClient.events.send ('pacman.edit.added', msg.data);
  }, function (done, useChest) { /* jshint ignore:line */
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

  zogLog.info ('upload %s to chest://%s:%d/%s',
               msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath,
               chestConfig.host,
               chestConfig.port,
               msg.data.chestFile);

  busClient.events.subscribe ('chest.send.finished', function (msg) {
    busClient.events.send ('pacman.edit.finished');
  });

  var chestMsg = {
    file: msg.data.wizardAnswers[msg.data.wizardAnswers.length - 1].localPath
  };
  busClient.command.send ('chest.send', chestMsg);
};

/**
 * Make the Control file for WPKG by using a package config file.
 * @param {Object} msg
 */
cmd.make = function (msg) {
  var packageName = msg.data.packageName;
  zogLog.info ('make the wpkg package for ' + (packageName || 'all'));

  var pkgMake = require ('./pkgMake.js');

  if (!packageName) {
    packageName = 'all';
  }

  if (packageName === 'all') {
    /* We use a grunt task for this job (with mtime check). */
    var grunt = require ('grunt');

    /* FIXME: broken stuff. */
    /* require ('./gruntTasks.js') (grunt); */
    grunt.tasks (['newer'], null, function () {
      busClient.events.send ('pacman.make.finished');
    });
  } else {
    pkgMake.package (packageName, null, function (done) { /* jshint ignore:line */
      busClient.events.send ('pacman.make.finished');
    }); /* TODO: arch support */
  }
};

/**
 * Try to install the developement package.
 * @param {Object} msg
 */
cmd.install = function (msg) {
  var packageRef = msg.data.packageRef;
  zogLog.info ('install development package: ' + packageRef);

  var pkgCmd = require ('./pkgCmd.js');

  pkgCmd.install (packageRef, function (done) { /* jshint ignore:line */
    busClient.events.send ('pacman.install.finished');
  });
};

/**
 * Try to remove the developement package.
 * @param {Object} msg
 */
cmd.remove = function (msg) {
  var packageRef = msg.data.packageRef;

  zogLog.info ('remove development package: ' + packageRef);

  var pkgCmd = require ('./pkgCmd.js');

  pkgCmd.remove (packageRef, function (done) { /* jshint ignore:line */
    busClient.events.send ('pacman.remove.finished');
  });
};

/**
 * Remove all the generated files.
 */
cmd.clean = function () {
  var fse   = require ('fs-extra');
  var zogFs = require ('xcraft-core-fs');

  zogLog.info ('clean all generated files');

  zogLog.verb ('delete ' + xcraftConfig.pkgTargetRoot);
  fse.removeSync (xcraftConfig.pkgTargetRoot);

  zogLog.verb ('delete ' + xcraftConfig.pkgDebRoot);
  fse.removeSync (xcraftConfig.pkgDebRoot);

  zogFs.ls (xcraftConfig.tempRoot, /^(?!.*\.gitignore)/).forEach (function (file) {
    file = path.join (xcraftConfig.tempRoot, file);
    zogLog.verb ('delete ' + file);

    var st = fse.statSync (file);
    if (st.isDirectory (file)) {
      fse.removeSync (file);
    } else {
      fse.unlinkSync (file);
    }
  });

  busClient.events.send ('pacman.clean.finished');
};

exports.xcraftCommands = function () {
  var utils  = require ('xcraft-core-utils');
  var rcFile = path.join (__dirname, './rc.json');
  var rc     = utils.jsonFile2Json (rcFile);
  var list   = [];

  Object.keys (cmd).forEach (function (action) {
    list.push ({
      name    : action,
      desc    : rc[action] ? rc[action].desc : '',
      params  : rc[action] ? rc[action].params : '',
      options : rc[action] ? rc[action].options : {},
      handler : cmd[action]
    });
  });

  return list;
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
  default: 'script' + zogPlatform.getShellExt ()
}, {
  type: 'input',
  name: 'pkgPostinst',
  message: 'postinst wpkg script name',
  default: 'postinst' + zogPlatform.getShellExt ()
}, {
  type: 'input',
  name: 'pkgPrerm',
  message: 'prerm wpkg script name',
  default: 'prerm' + zogPlatform.getShellExt ()
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
