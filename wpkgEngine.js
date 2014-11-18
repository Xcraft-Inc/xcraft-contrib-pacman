'use strict';

var moduleName = 'wpkg';

var path = require ('path');
var fs   = require ('fs');

var xLog         = require ('xcraft-core-log') (moduleName);
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

/**
 * Create a wrapper on wpkg.
 * @class wpkg wrapper.
 * @param {function(err, results)} callback
 */
var WpkgArgs = function (callback) {
  var xProcess = require ('xcraft-core-process');
  var bin = 'wpkg';

  /**
   * Spawn wpkg and handle the outputs.
   * @param {string[]} args - Arguments.
   * @param {string} [lastArg] - The last argument.
   * @param {function(stdout)} [callbackStdout]
   * @param {string[]} callbackStdout.line - The current stdout line.
   */
  var run = function (args, lastArg, callbackStdout) {
    var cmdName = args[args.length - 1];

    xLog.info ('begin command ' + cmdName);

    if (lastArg) {
      args.push (lastArg);
    }

    xLog.verb ('%s %s', bin, args.join (' '));

    xProcess.spawn (bin, args, function (err) {
      /* When the call is terminated. */
      xLog.info ('end command ' + cmdName);

      if (callback) {
        callback (err);
      }
    }, function (line) {
      /* For each line in stdout. */
      if (/^error/.test (line)) {
        xLog.err (line);
      } else {
        xLog.verb (line);
      }

      if (callbackStdout) {
        callbackStdout (line);
      }
    }, function (line) {
      /* For each line in stderr. */
      if (/^wpkg:debug/.test (line)) {
        xLog.verb (line);
      } else if (/^wpkg:info/.test (line)) {
        xLog.info (line);
      } else if (/^wpkg:warning/.test (line) ||
                 /^\(node\) warning/.test (line)) {
        xLog.warn (line);
      } else {
        xLog.err (line);
      }
    });
  };

  return {
    build: function (packagePath, arch) {
      var args = [
        '--verbose',
        '--output-repository-dir', path.join (xcraftConfig.pkgDebRoot, arch),
        '--compressor', 'gz',
        '--zlevel', 6,
        '--build'
      ];

      run (args, packagePath);
    },

    createIndex: function (repositoryPath, indexName) {
      var args = [
        '--verbose',
        '--repository', repositoryPath,
        '--create-index'
      ];

      run (args, path.join (repositoryPath, indexName));
    },

    install: function (packagePath, arch) {
      var allRepository = path.join (xcraftConfig.pkgDebRoot,
                                     'all',
                                     pacmanConfig.pkgRepository);
      var args =  [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--repository', path.join (xcraftConfig.pkgDebRoot,
                                   arch,
                                   pacmanConfig.pkgRepository)
      ];

      /* Maybe there is a 'all' repository, in this case we add this one. */
      if (fs.existsSync (allRepository)) {
        args.push (allRepository);
      }

      args.push ('--install');

      run (args, packagePath);
    },

    remove: function (packageName, arch) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--remove'
      ];

      run (args, packageName);
    },

    createAdmindir: function (controlFile, arch) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--create-admindir'
      ];

      run (args, controlFile);
    },

    addSources: function (source, arch) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--add-sources'
      ];

      run (args, source);
    },

    listSources: function (arch, listOut) {
      var args = [
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--list-sources'
      ];

      run (args, null, function (line) {
        if (!line.trim ().length) {
          return;
        }

        listOut.push (line.trim ());
      });
    },

    update: function (arch) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--update'
      ];

      run (args);
    },

    listIndexPackages: function (repositoryPath, arch, listOut) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--list-index-packages'
      ];

      run (args, path.join (repositoryPath, pacmanConfig.pkgIndex), function (line) {
        var result = line.trim ().match (/.* ([^ _]*)([^ ]*)\.ctrl$/);
        var deb  = result[1] + result[2] + '.deb';
        var name = result[1];

        listOut[name] = deb;
      });
    }
  };
};

/**
 * Build a new package.
 * @param {string} packagePath
 * @param {string} distribution
 * @param {function(err, results)} callback
 */
exports.build = function (packagePath, distribution, callback) {
  var pathObj = packagePath.split (path.sep);

  /* Retrieve the architecture which is in the packagePath. */
  var arch = pathObj[pathObj.length - 2];

  var wpkg = new WpkgArgs (function (err) {
    if (err) {
      callback (err);
      return;
    }

    var wpkg = new WpkgArgs (callback);
    var repositoryPath = path.join (xcraftConfig.pkgDebRoot, arch, distribution);

    /* We create or update the index with our new package. */
    wpkg.createIndex (repositoryPath, pacmanConfig.pkgIndex);
  });

  wpkg.build (packagePath, arch);
};

var lookForPackage = function (packageName, archRoot, arch, callbackResult) {
  var repositoryPath = path.join (xcraftConfig.pkgDebRoot,
                                  arch,
                                  pacmanConfig.pkgRepository
                                 );
  var list = [];

  var wpkg = new WpkgArgs (function (err) {
    if (err) {
      return;
    }

    /* The list array is populated by listIndexPackages. */
    var debFile = list[packageName];
    if (!debFile) {
      xLog.warn ('the package %s is unavailable in %s', packageName, arch);
      if (callbackResult) {
        callbackResult (null);
      }
      return;
    }

    /* We have found the package, then we can build the full path and install
     * this one to the target root.
     */
    debFile = path.join (repositoryPath, debFile);

    if (callbackResult) {
      callbackResult (debFile, arch);
    }
  });

  /* wpkg is not able to install a package just by its name. The sources are
   * ignored in this case. Then we must look in the repository index file if
   * the package exists and in order to retrieve the full package name.
   */
  wpkg.listIndexPackages (repositoryPath, archRoot, list);
};

/**
 * Install a package with its dependencies.
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.install = function (packageName, arch, callback) {
  lookForPackage (packageName, arch, arch, function (debFile) {
    var wpkg = new WpkgArgs (callback);

    if (debFile) {
      wpkg.install (debFile, arch);
      return;
    }

    lookForPackage (packageName, arch, 'all', function (debFile) {
      if (debFile) {
        wpkg.install (debFile, arch);
      }
    });
  });
};

/**
 * Remove a package.
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.remove = function (packageName, arch, callback) {
  var wpkg = new WpkgArgs (callback);
  wpkg.remove (packageName, arch);
};

/**
 * Create the administration directory in the target root.
 * The target root is the destination where are installed the packages.
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.createAdmindir = function (arch, callback) {
  var util = require ('util');
  var fs   = require ('fs');

  var xFs = require ('xcraft-core-fs');

  /* This control file is used in order to create a new admin directory. */
  var controlFile = path.join (xcraftConfig.tempRoot, 'control');
  var data = util.format ('Architecture: %s\n' +
                          'Maintainer: "Xcraft Toolchain" <xcraft@epsitec.ch>\n' +
                          'Distribution: %s\n',
                          arch, pacmanConfig.pkgRepository);

  fs.writeFileSync (controlFile, data);

  /* Create the target directory. */
  xFs.mkdir (path.join (xcraftConfig.pkgTargetRoot, arch));

  var wpkg = new WpkgArgs (callback);
  wpkg.createAdmindir (controlFile, arch);
};

/**
 * Add a new source in the target installation.
 * A source is needed in order to upgrade the packages in the target root
 * accordingly to the versions in the repository referenced in the source.
 * @param {string} sourcePath
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.addSources = function (sourcePath, arch, callback) {
  var list = [];

  var wpkg = new WpkgArgs (function (err) {
    if (err) {
      callback (err);
      return;
    }

    /* The list array is populated by listSources. */
    if (list.indexOf (sourcePath) >= 0) {
      callback ();
      return; /* already in the sources.list */
    }

    var wpkg = new WpkgArgs (callback);
    wpkg.addSources (sourcePath, arch);
  });

  wpkg.listSources (arch, list);
};

/**
 * Update the list of available packages from the repository.
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.update = function (arch, callback) {
  var wpkg = new WpkgArgs (callback);
  wpkg.update (arch);
};
