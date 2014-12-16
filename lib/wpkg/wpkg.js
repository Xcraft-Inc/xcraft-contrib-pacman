'use strict';

var moduleName = 'wpkg';

var path = require ('path');
var fs   = require ('fs');

var xLog         = require ('xcraft-core-log') (moduleName);
var xCMake       = require ('xcraft-contrib-cmake');
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');

/**
 * Create a wrapper on wpkg.
 *
 * @class wpkg wrapper.
 * @param {function(err, results)} callback
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

  var addRepositories = function (arch) {
    var first = true;
    var args  = [];

    [arch, 'all', 'source'].forEach (function (arch) {
      var repo = path.join (xcraftConfig.pkgDebRoot,
                            arch, pacmanConfig.pkgRepository);
      if (fs.existsSync (repo)) {
        if (first) {
          args.push ('--repository');
          first = false;
        }
        args.push (repo);
      }
    });

    return args;
  };

  return {
    build: function (packagePath, arch) {
      var args = [
        '--verbose',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch),
        '--output-repository-dir', path.join (xcraftConfig.pkgDebRoot, arch),
        '--compressor', 'gz',
        '--zlevel', 6,
        '--cmake-generator', cmake,
        '--make-tool', make
      ];

      args.concat (addRepositories (arch));
      args.push ('--build');

      run (args, packagePath);
    },

    buildSrc: function (arch) {
      var args = [
        '--verbose',
        '--output-repository-dir', path.join (xcraftConfig.pkgDebRoot, arch),
        '--build',
        '--cmake-generator', cmake,
        '--make-tool', make
      ];

      run (args);
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
      var args =  [
        '--verbose',
        '--force-file-info',
        '--root', path.join (xcraftConfig.pkgTargetRoot, arch)
      ];

      args.concat (addRepositories (arch));
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

var build = function (packagePath, isSource, distribution, callback) {
  var pathObj = packagePath.split (path.sep);

  /* Retrieve the architecture which is in the packagePath. */
  var arch = pathObj[pathObj.length - 2];
  var currentDir = process.cwd ();
  var envPath = process.env.PATH;

  var wpkg = new WpkgArgs (function (err) {
    process.env.PATH = envPath;
    process.chdir (currentDir);

    if (err) {
      callback (err);
      return;
    }

    var wpkg = new WpkgArgs (callback);
    var repositoryPath = path.join (xcraftConfig.pkgDebRoot, arch, distribution);

    /* We create or update the index with our new package. */
    wpkg.createIndex (repositoryPath, pacmanConfig.pkgIndex);
  });

  if (isSource) {
    process.chdir (packagePath);
    envPath = xCMake.stripShForMinGW ();
    wpkg.buildSrc (arch);
  } else {
    wpkg.build (packagePath, arch);
  }
};

/**
 * Build a new standard package.
 *
 * @param {string} packagePath
 * @param {string} distribution
 * @param {function(err, results)} callback
 */
exports.build = function (packagePath, distribution, callback) {
  build (packagePath, false, distribution, callback);
};

/**
 * Build a new source package.
 *
 * @param {string} packagePath
 * @param {string} distribution - Always replaced by 'sources'.
 * @param {function(err, results)} callback
 */
exports.buildSrc = function (packagePath, distribution, callback) {
  build (packagePath, true, 'sources', callback);
};

exports.buildFromSrc = function (packageName, arch, distribution, callback) {
  var wpkg = new WpkgArgs (function (err) {
    process.env.PATH = envPath;
    callback (err);
  });

  var envPath = xCMake.stripShForMinGW ();

  lookForPackage (packageName, arch, 'source', function (deb) {
    if (!deb) {
      callback ('package not found');
      return;
    }

    wpkg.build (deb, arch);
  });
};

var lookForPackage = function (packageName, archRoot, arch, callbackResult) {
  var repositoryPath = path.join (xcraftConfig.pkgDebRoot, arch,
                                  arch === 'source' ? 'sources' : pacmanConfig.pkgRepository);
  var list = [];

  if (!fs.existsSync (repositoryPath)) {
    if (callbackResult) {
      callbackResult (null);
    }
    return;
  }

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
 *
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.install = function (packageName, arch, callback) {
  var async = require ('async');

  var debFile = null;
  var archs   = [arch, 'all', 'source'];
  var wpkg    = new WpkgArgs (callback);

  async.detectSeries (archs, function (item, callback) {
    lookForPackage (packageName, arch, item, function (deb) {
      debFile = deb;
      callback (!!deb);
    });
  }, function (result) {
    if (result) {
      wpkg.install (debFile, arch);
    } else {
      callback ('package not found');
    }
  });
};

/**
 * Remove a package.
 *
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
 *
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
 *
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
 *
 * @param {string} arch - Architecture.
 * @param {function(err, results)} callback
 */
exports.update = function (arch, callback) {
  var wpkg = new WpkgArgs (callback);
  wpkg.update (arch);
};
