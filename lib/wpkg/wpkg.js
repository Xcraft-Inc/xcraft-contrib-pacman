'use strict';

var moduleName = 'wpkg';

var path = require ('path');
var fs   = require ('fs');

var xLog         = require ('xcraft-core-log') (moduleName);
var xCMake       = require ('xcraft-contrib-cmake');
var xPath        = require ('xcraft-core-path');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

var utils = require ('../utils');


/**
 * Create a wrapper on wpkg.
 *
 * @class wpkg wrapper.
 * @param {Function(err, results)} callback
 */
var WpkgArgs = function (callback) {
  var xProcess = require ('xcraft-core-process');
  var bin = 'wpkg';

  var cmake = xCMake.getGenerator ();
  var make  = xCMake.getMakeTool ();

  /**
   * Spawn wpkg and handle the outputs.
   *
   * @param {string[]} args - Arguments.
   * @param {string} [lastArg] - The last argument.
   * @param {Function(stdout)} [callbackStdout]
   * @param {string[]} callbackStdout.line - The current stdout line.
   */
  var run = function (args, lastArg, callbackStdout) {
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

  return {
    build: function (packagePath, arch) {
      var args = [];

      var root = path.join (xcraftConfig.pkgTargetRoot, arch);
      if (fs.existsSync (root)) {
        args = ['--root', root];
      }

      args = args.concat ([
        '--verbose',
        '--force-file-info',
        '--output-repository-dir', xcraftConfig.pkgDebRoot,
        '--compressor', 'gz',
        '--zlevel', 6,
        '--cmake-generator', cmake,
        '--make-tool', make
      ]);

      args = args.concat (addRepositories ());
      args.push ('--build');

      run (args, packagePath);
    },

    buildSrc: function () {
      var args = [
        '--verbose',
        '--output-repository-dir', xcraftConfig.pkgDebRoot,
        '--cmake-generator', cmake,
        '--make-tool', make,
        '--build'
      ];

      run (args);
    },

    createIndex: function (repositoryPath, indexName) {
      var args = [
        '--verbose',
        '--repository', repositoryPath,
        '--recursive',
        '--create-index'
      ];

      run (args, path.join (repositoryPath, indexName));
    },

    install: function (packagePath, arch, reinstall) {
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

      run (args, packagePath);
    },

    isInstalled: function (packageName, arch) {
      var args = [
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--is-installed'
      ];

      run (args, packageName);
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

    listIndexPackages: function (repositoryPath, arch, filters, listOut) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--list-index-packages'
      ];

      run (args, path.join (repositoryPath, pacmanConfig.pkgIndex), function (line) {
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
    }
  };
};

/**
 * Retrieve a list of packages available in a repository accordingly to filters.
 *
 * @param {string} repositoryPath
 * @param {string} arch
 * @param {Object} filters
 * @param {Function(err, results)} callback
 */
exports.listIndexPackages = function (repositoryPath, arch, filters, callback) {
  var list = [];

  if (!fs.existsSync (repositoryPath)) {
    callback ('repository not found');
    return;
  }

  var wpkg = new WpkgArgs (function (err) {
    /* The list array is populated by listIndexPackages. */
    callback (err, list);
  });

  wpkg.listIndexPackages (repositoryPath, arch, filters, list);
};

var lookForPackage = function (packageName, archRoot, callback) {
  var repositoryPath = xcraftConfig.pkgDebRoot;

  var filters = {
    name: packageName,
    arch: new RegExp ('(' + archRoot + '|all)')
  };

  /* wpkg is able to install a package just by its name. But it's not possible
   * in this case to specify for example a version. And there is a regression
   * with the new way. Then we must look in the repository index file if
   * the package exists and in order to retrieve the full package name.
   */
  exports.listIndexPackages (repositoryPath, archRoot, filters, function (err, list) {
   if (err) {
     callback (err);
     return;
   }

   var debFile = list[packageName];
   if (!debFile) {
     xLog.warn ('the package %s is unavailable', packageName);
     callback ('package not found');
     return;
   }

   /* We have found the package, then we can build the full path and install
    * this one to the target root.
    */
   debFile = path.join (repositoryPath, debFile);
   callback (null, debFile);
 });
};

var build = function (packagePath, isSource, distribution, callback) {
  var pathObj = packagePath.split (path.sep);

  /* Retrieve the architecture which is in the packagePath. */
  var arch = pathObj[pathObj.length - 2];
  var currentDir = process.cwd ();
  var envPath = null;

  var wpkg = new WpkgArgs (function (err) {
    if (envPath) {
      xPath.insert (envPath.index, envPath.location);
    }
    process.chdir (currentDir);

    if (err) {
      callback (err);
      return;
    }

    var wpkg = new WpkgArgs (callback);
    var repositoryPath = xcraftConfig.pkgDebRoot;

    /* We create or update the index with our new package. */
    wpkg.createIndex (repositoryPath, pacmanConfig.pkgIndex);
  });

  if (isSource) {
    process.chdir (packagePath);
    envPath = xCMake.stripShForMinGW ();
    wpkg.buildSrc ();
  } else {
    wpkg.build (packagePath, arch);
  }
};

/**
 * Build a new standard package.
 *
 * @param {string} packagePath
 * @param {string} distribution
 * @param {Function(err, results)} callback
 */
exports.build = function (packagePath, distribution, callback) {
  build (packagePath, false, distribution, callback);
};

/**
 * Build a new source package.
 *
 * @param {string} packagePath
 * @param {string} distribution - Always replaced by 'sources'.
 * @param {Function(err, results)} callback
 */
exports.buildSrc = function (packagePath, distribution, callback) {
  build (packagePath, true, 'sources', callback);
};

/**
 * Build a new binary package from a source package.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture
 * @param {string} distribution
 * @param {Function(err, results)} callback
 */
exports.buildFromSrc = function (packageName, arch, distribution, callback) {
  var wpkg = new WpkgArgs (function (err) {
    if (envPath) {
      xPath.insert (envPath.index, envPath.location);
    }

    if (err) {
      callback (err);
      return;
    }

    var repositoryPath = xcraftConfig.pkgDebRoot;

    /* We create or update the index with our new package. */
    var wpkg = new WpkgArgs (callback);
    wpkg.createIndex (repositoryPath, pacmanConfig.pkgIndex);
  });

  var envPath = xCMake.stripShForMinGW ();

  /* Without packageName we consider the build of all source packages. */
  if (!packageName) {
    if (!fs.existsSync (path.join (xcraftConfig.pkgDebRoot, 'sources'))) {
      xLog.info ('nothing to build');
      callback ();
      return;
    }

    wpkg.build (xcraftConfig.pkgDebRoot, arch);
    return;
  }

  lookForPackage (packageName, arch, function (err, deb) {
    if (err) {
      callback (err);
      return;
    }

    wpkg.build (deb, arch);
  });
};

/**
 * Install a package with its dependencies.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {boolean} reinstall
 * @param {Function(err, results)} callback
 */
exports.install = function (packageName, arch, reinstall, callback) {
  var wpkg = new WpkgArgs (callback);

  lookForPackage (packageName, arch, function (err, deb) {
    if (err) {
      callback (err);
      return;
    }

    wpkg.install (deb, arch, reinstall);
  });
};

/**
 * Test if a package is already installed.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture
 * @param {Function(err, results)} callback
 */
exports.isInstalled = function (packageName, arch, callback) {
  var wpkg = new WpkgArgs (function (err, code) {
    if (err) {
      callback (err);
      return;
    }

    callback (null, !code);
  });

  wpkg.isInstalled (packageName, arch);
};

/**
 * Remove a package.
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {Function(err, results)} callback
 */
exports.remove = function (packageName, arch, callback) {
  var wpkg = new WpkgArgs (callback);
  wpkg.remove (packageName, arch);
};

/**
 * Create the administration directory in the target root.
 * The target root is the destination where are installed the packages.
 *
 * @param {string} arch - Architecture.
 * @param {Function(err, results)} callback
 */
exports.createAdmindir = function (arch, callback) {
  var xFs = require ('xcraft-core-fs');
  var xPh = require ('xcraft-core-placeholder');

  /* This control file is used in order to create a new admin directory. */
  var fileIn  = path.join (__dirname, '../templates/admindir.control');
  var fileOut = path.join (xcraftConfig.tempRoot, 'control');

  var ph = new xPh.Placeholder ();
  ph.set ('ARCHITECTURE',     arch)
    .set ('MAINTAINER.NAME',  'Xcraft Toolchain')
    .set ('MAINTAINER.EMAIL', 'xcraft@xcraft.ch')
    .set ('DISTRIBUTION',     pacmanConfig.pkgRepository)
    .injectFile ('ADMINDIR', fileIn, fileOut);

  /* Create the target directory. */
  xFs.mkdir (path.join (xcraftConfig.pkgTargetRoot, arch));

  var wpkg = new WpkgArgs (callback);
  wpkg.createAdmindir (fileOut, arch);
};

/**
 * Add a new source in the target installation.
 * A source is needed in order to upgrade the packages in the target root
 * accordingly to the versions in the repository referenced in the source.
 *
 * @param {string} sourcePath
 * @param {string} arch - Architecture.
 * @param {Function(err, results)} callback
 */
exports.addSources = function (sourcePath, arch, callback) {
  var async = require ('async');

  async.auto ({
    checkSources: function (callback) {
      var sourcesList = path.join (xcraftConfig.pkgTargetRoot,
                                   arch, 'var/lib/wpkg/core/sources.list');
      var exists = fs.existsSync (sourcesList);
      callback (null, exists);
    },

    listSources: ['checkSources', function (callback, results) {
      var list = [];

      if (!results.checkSources) {
        callback (null, list);
        return;
      }

      var wpkg = new WpkgArgs (function (err) {
        callback (err, list);
      });
      wpkg.listSources (arch, list);
    }],

    addSources: ['listSources', function (callback, results) {
      /* The list array is populated by listSources. */
      if (results.listSources.indexOf (sourcePath) >= 0) {
        callback ();
        return; /* already in the sources.list */
      }

      var wpkg = new WpkgArgs (callback);
      wpkg.addSources (sourcePath, arch);
    }]
  }, callback);
};

/**
 * Update the list of available packages from the repository.
 *
 * @param {string} arch - Architecture.
 * @param {Function(err, results)} callback
 */
exports.update = function (arch, callback) {
  var wpkg = new WpkgArgs (callback);
  wpkg.update (arch);
};
