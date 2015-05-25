'use strict';

var moduleName = 'wpkg-wrapper';

var path = require ('path');
var fs   = require ('fs');

var xLog         = require ('xcraft-core-log') (moduleName);
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


var addRepositories = function () {
  var first = true;
  var args  = [];

  var repo = xcraftConfig.pkgDebRoot;
  if (fs.existsSync (repo)) {
    if (first) {
      args.push ('--repository');
      first = false;
    }
    args.push (repo);
  }

  return args;
};

/**
 * Create a wrapper on wpkg.
 *
 * @class wpkg wrapper.
 * @param {Function(err, results)} callback
 */
function WpkgWrapper (callback) {
  var xCMake = require ('xcraft-contrib-cmake');

  this._cmake = xCMake.getGenerator ();
  this._make  = xCMake.getMakeTool ();

  /**
   * Spawn wpkg and handle the outputs.
   *
   * @param {string[]} args - Arguments.
   * @param {string} [lastArg] - The last argument.
   * @param {Function(stdout)} [callbackStdout]
   * @param {string[]} callbackStdout.line - The current stdout line.
   */
  this._run = function (args, lastArg, callbackStdout) {
    var xProcess = require ('xcraft-core-process') ({
      mod:       moduleName,
      logger:    'xlog',
      forwarder: 'wpkg'
    });

    var bin = 'wpkg';
    var cmdName = args[args.length - 1];

    xLog.info ('begin command ' + cmdName);

    if (lastArg) {
      args.push (lastArg);
    }

    xLog.verb ('%s %s', bin, args.join (' '));

    xProcess.spawn (bin, args, {}, function (err, code) {
      /* When the call is terminated. */
      xLog.info ('end command ' + cmdName + ' with rc ' + code);

      if (callback) {
        callback (err, code);
      }
    }, callbackStdout);
  };
}

WpkgWrapper.prototype.build = function (packagePath, arch) {
  var args = [];

  var root = path.join (xcraftConfig.pkgTargetRoot, arch);
  if (fs.existsSync (root)) {
    args = ['--root', root];
  }

  args = args.concat ([
    '--verbose',
    '--force-file-info',
    '--output-repository-dir', xcraftConfig.pkgDebRoot,
    '--install-prefix', '/usr',
    '--compressor', 'gz',
    '--zlevel', 6,
    '--cmake-generator', this._cmake,
    '--make-tool', this._make
  ]);

  args = args.concat (addRepositories ());
  args.push ('--build');

  this._run (args, packagePath);
};

WpkgWrapper.prototype.buildSrc = function () {
  var args = [
    '--verbose',
    '--output-repository-dir', xcraftConfig.pkgDebRoot,
    '--cmake-generator', this._cmake,
    '--make-tool', this._make,
    '--build'
  ];

  this._run (args);
};

WpkgWrapper.prototype.createIndex = function (repositoryPath, indexName) {
  var args = [
    '--verbose',
    '--repository', repositoryPath,
    '--recursive',
    '--create-index'
  ];

  this._run (args, path.join (repositoryPath, indexName));
};

WpkgWrapper.prototype.install = function (packagePath, arch, reinstall) {
  var args = [
    '--verbose',
    '--force-file-info',
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch)
  ];

  args = args.concat (addRepositories ());

  if (!reinstall) {
    args.push ('--skip-same-version');
  }

  args.push ('--install');

  this._run (args, packagePath);
};

WpkgWrapper.prototype.isInstalled = function (packageName, arch) {
  var args = [
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--is-installed'
  ];

  this._run (args, packageName);
};

WpkgWrapper.prototype.remove = function (packageName, arch) {
  var args = [
    '--verbose',
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--remove'
  ];

  this._run (args, packageName);
};

WpkgWrapper.prototype.createAdmindir = function (controlFile, arch) {
  var args = [
    '--verbose',
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--create-admindir'
  ];

  this._run (args, controlFile);
};

WpkgWrapper.prototype.addSources = function (source, arch) {
  var args = [
    '--verbose',
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--add-sources'
  ];

  this._run (args, source);
};

WpkgWrapper.prototype.listSources = function (arch, listOut) {
  var args = [
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--list-sources'
  ];

  this._run (args, null, function (line) {
    if (!line.trim ().length) {
      return;
    }

    listOut.push (line.trim ());
  });
};

WpkgWrapper.prototype.update = function (arch) {
  var args = [
    '--verbose',
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--update'
  ];

  this._run (args);
};

WpkgWrapper.prototype.listIndexPackages = function (repositoryPath, arch, filters, listOut) {
  var utils = require ('../utils');

  var args = [
    '--verbose',
    '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
    '--list-index-packages'
  ];

  this._run (args, path.join (repositoryPath, pacmanConfig.pkgIndex), function (line) {
    var result = line.trim ().match (/.* (?:(.*)\/)?([^ _]*)_([^ _]*)(?:_([^ _]*))?\.ctrl$/);

    var deb = {
      distrib: result[1],
      name:    result[2],
      version: result[3],
      arch:    result[4]
    };

    var res = Object.keys (deb).every (function (it) {
      if (!deb[it] || !filters[it]) {
        return true;
      }

      return utils.toRegexp (filters[it]).test (deb[it]);
    });

    if (!res) {
      return;
    }

    var debFile = '';
    if (deb.distrib) {
      debFile = deb.distrib + '/';
    }
    debFile += deb.name + '_' + deb.version;

    if (deb.arch) {
      debFile += '_' + deb.arch;
    }

    listOut[deb.name] = debFile + '.deb';
  });
};

module.exports = WpkgWrapper;