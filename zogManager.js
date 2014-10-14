'use strict';

/* ᗤ <- pacman ? */
var moduleName = 'pacman';

var path     = require ('path');
var inquirer = require ('inquirer');

var pkgCreate     = require ('./pkgCreate.js');
var pkgDefinition = require ('./pkgDefinition.js');
var zogLog        = require ('xcraft-core-log') (moduleName);
var busClient     = require ('xcraft-core-busclient');
var zogPlatform   = require ('xcraft-core-platform');
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');

var cmd = {};

cmd.list = function () {
  var util = require ('util');

  zogLog.info ('list of all products');

  var pkgList = require ('./pkgList.js');

  var list = pkgList.listProducts ();
  var header = util.format ('name%s version%s architectures',
                            new Array (40 - 'name'.length).join (' '),
                            new Array (15 - 'version'.length).join (' '));
  console.log (header);
  console.log (new Array (header.length + 1).join ('-'));
  list.forEach (function (def) {
    console.log ('%s%s %s%s',
                 def.name,
                 new Array (40 - def.name.length).join (' '),
                 def.version,
                 new Array (15 - def.version.toString ().length).join (' '),
                 def.architecture.join (', '));
  });

  busClient.events.send ('zogManager.list', list);
  busClient.events.send ('zogManager.list.finished');
};

/**
 * Create a new package template or modify an existing package config file.
 * @param {Object} msg
 */
cmd.edit = function (msg) {
  var packageName = msg.data.packageName;
  msg.data.isPassive   = msg.data.isPassive || false;
  msg.data.packageDef  = [];

  zogLog.info ('create a new package: ' + packageName);

  try {
    busClient.command.send ('zogManager.edit.header', msg.data);
  } catch (err) {
    zogLog.err (err);
  }
};

cmd['edit.header'] = function (msg) {
  var packageName = msg.data.packageName;
  var packageDef  = msg.data.packageDef;
  var isPassive   = msg.data.isPassive;
  var wizard      = require ('./wizard.js');

  /* The first question is the package's name, then we set the default value. */
  wizard.header[0].default = packageName;

  try {
    var def = pkgDefinition.load (packageName);

    wizard.header[1].default = def.version;
    wizard.header[2].default = def.maintainer.name;
    wizard.header[3].default = def.maintainer.email;
    wizard.header[4].default = def.architecture;
    wizard.header[5].default = def.description.brief;
    wizard.header[6].default = def.description.long;
  } catch (err) {}

  if (!isPassive) {
    inquirer.prompt (wizard.header, function (answers) {
      packageDef.push (answers);

      /* Indices for the dependency. */
      msg.data.idxDep   = 0;
      msg.data.idxRange = 0;
      busClient.command.send ('zogManager.edit.dependency', msg.data, null);
    });
  } else {
    busClient.events.send ('zogManager.edit.header.added', wizard.header);
  }
};

cmd['edit.dependency'] = function (msg) {
  var packageName = msg.data.packageName;
  var packageDef  = msg.data.packageDef;
  var isPassive   = msg.data.isPassive;
  var wizard      = require ('./wizard.js');

  try {
    var def  = pkgDefinition.load (packageName);
    var keys = Object.keys (def.dependency);

    if (keys.length > msg.data.idxDep) {
      var key = keys[msg.data.idxDep];

      if (def.dependency[key].length > msg.data.idxRange) {
        wizard.dependency[0].default = true;
        wizard.dependency[1].default = wizard.dependency[1].choices.indexOf (key);
        wizard.dependency[2].default = def.dependency[key][msg.data.idxRange];
        msg.data.idxRange++;
      } else {
        wizard.dependency[0].default = false;
        delete wizard.dependency[1].default;
        delete wizard.dependency[2].default;
        msg.data.idxDep++;
      }
    }
  } catch (err) {}

  if (!isPassive) {
    inquirer.prompt (wizard.dependency, function (answers) {
      packageDef.push (answers);

      var subCmd = answers.hasDependency ? 'dependency' : 'data';
      busClient.command.send ('zogManager.edit.' + subCmd, msg.data, null);
    });
  } else {
    busClient.events.send ('zogManager.edit.dependency.added', wizard.dependency);
  }
};

cmd['edit.data'] = function (msg) {
  var packageName = msg.data.packageName;
  var packageDef  = msg.data.packageDef;
  var isPassive   = msg.data.isPassive;
  var wizard      = require ('./wizard.js');

  try {
    var def = pkgDefinition.load (packageName);

    wizard.data[0].default = def.data.uri;
    wizard.data[1].default = def.data.type;
    wizard.data[2].default = def.data.rules.type;
    wizard.data[3].default = def.data.rules.location;
    wizard.data[4].default = def.data.rules.args.install;
    wizard.data[5].default = def.data.rules.args.remove;
    wizard.data[6].default = def.data.embedded;
  } catch (err) {}

  if (!isPassive) {
    inquirer.prompt (wizard.data, function (answers) {
      packageDef.push (answers);
      busClient.command.send ('zogManager.edit.save', msg.data);
    });
  } else {
    busClient.events.send ('zogManager.edit.data.added', wizard.data);
  }
};

cmd['edit.save'] = function (msg) {
  var packageDef  = msg.data.packageDef;
  zogLog.verb ('JSON output for pre-package definition:\n' +
               JSON.stringify (packageDef, null, '  '));

  pkgCreate.pkgTemplate (packageDef, function (done) { /* jshint ignore:line */
    busClient.events.send ('zogManager.edit.finished');
  });
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
      busClient.events.send ('zogManager.make.finished');
    });
  } else {
    pkgMake.package (packageName, null, function (done) { /* jshint ignore:line */
      busClient.events.send ('zogManager.make.finished');
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
    busClient.events.send ('zogManager.install.finished');
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
    busClient.events.send ('zogManager.remove.finished');
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

  busClient.events.send ('zogManager.clean.finished');
};

exports.xcraftCommands = function () {
  var rc   = require ('./rc.json');
  var list = [];

  Object.keys (cmd).forEach (function (action) {
    list.push ({
      name   : action,
      desc   : rc[action] || '',
      handler: cmd[action]
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
