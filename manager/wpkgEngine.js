'use strict';

var moduleName = 'wpkg';

var path      = require ('path');
var fs        = require ('fs');
var zogLog    = require ('xcraft-core-log') (moduleName);

/**
 * Create a wrapper on wpkg.
 * @class wpkg wrapper.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
var WpkgArgs = function (zogConfig, callbackDone) {
  var zogProcess = require ('xcraft-core-process');
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

    zogLog.info ('begin command ' + cmdName);

    if (lastArg) {
      args.push (lastArg);
    }

    zogLog.verb ('%s %s', bin, args.join (' '));

    zogProcess.spawn (bin, args, function (done) {
      /* When the call is terminated. */
      zogLog.info ('end command ' + cmdName);

      if (callbackDone) {
        callbackDone (done);
      }
    }, function (line) {
      /* For each line in stdout. */
      if (/^error/.test (line)) {
        zogLog.err (line);
      } else {
        zogLog.verb (line);
      }

      if (callbackStdout) {
        callbackStdout (line);
      }
    }, function (line) {
      /* For each line in stderr. */
      if (/^wpkg:debug/.test (line)) {
        zogLog.verb (line);
      } else if (/^wpkg:info/.test (line)) {
        zogLog.info (line);
      } else if (/^wpkg:warning/.test (line) ||
                 /^\(node\) warning/.test (line)) {
        zogLog.warn (line);
      } else {
        zogLog.err (line);
      }
    });
  };

  return {
    build: function (packagePath, arch) {
      var args = [
        '--verbose',
        '--output-repository-dir', path.join (zogConfig.pkgDebRoot, arch),
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
      var allRepository = path.join (zogConfig.pkgDebRoot, 'all', zogConfig.pkgRepository);
      var args =  [
        '--verbose',
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
        '--repository', path.join (zogConfig.pkgDebRoot, arch, zogConfig.pkgRepository)
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
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
        '--remove'
      ];

      run (args, packageName);
    },

    createAdmindir: function (controlFile, arch) {
      var args = [
        '--verbose',
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
        '--create-admindir'
      ];

      run (args, controlFile);
    },

    addSources: function (source, arch) {
      var args = [
        '--verbose',
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
        '--add-sources'
      ];

      run (args, source);
    },

    listSources: function (arch, listOut) {
      var args = [
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
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
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
        '--update'
      ];

      run (args);
    },

    listIndexPackages: function (repositoryPath, arch, listOut) {
      var args = [
        '--verbose',
        '--root', path.join (zogConfig.pkgTargetRoot, arch),
        '--list-index-packages'
      ];

      run (args, path.join (repositoryPath, zogConfig.pkgIndex), function (line) {
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
 * @param {Object} zogConfig
 * @param {string} packagePath
 * @param {string} distribution
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.build = function (zogConfig, packagePath, distribution, callbackDone) {
  var pathObj = packagePath.split (path.sep);

  /* Retrieve the architecture which is in the packagePath. */
  var arch = pathObj[pathObj.length - 2];

  var wpkg = new WpkgArgs (zogConfig, function (done) {
    if (!done) {
      callbackDone (false);
      return;
    }

    var wpkg = new WpkgArgs (zogConfig, callbackDone);
    var repositoryPath = path.join (zogConfig.pkgDebRoot, arch, distribution);

    /* We create or update the index with our new package. */
    wpkg.createIndex (repositoryPath, zogConfig.pkgIndex);
  });

  wpkg.build (packagePath, arch);
};

var lookForPackage = function (zogConfig, packageName, archRoot, arch, callbackResult) {
  var repositoryPath = path.join (zogConfig.pkgDebRoot, arch, zogConfig.pkgRepository);
  var list = [];

  var wpkg = new WpkgArgs (zogConfig, function (done) {
    if (!done) {
      return;
    }

    /* The list array is populated by listIndexPackages. */
    var debFile = list[packageName];
    if (!debFile) {
      zogLog.warn ('the package %s is unavailable in %s', packageName, arch);
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
 * @param {Object} zogConfig
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.install = function (zogConfig, packageName, arch, callbackDone) {
  lookForPackage (zogConfig, packageName, arch, arch, function (debFile) {
    var wpkg = new WpkgArgs (zogConfig, callbackDone);

    if (debFile) {
      wpkg.install (debFile, arch);
      return;
    }

    lookForPackage (zogConfig, packageName, arch, 'all', function (debFile) {
      if (debFile) {
        wpkg.install (debFile, arch);
      }
    });
  });
};

/**
 * Remove a package.
 * @param {Object} zogConfig
 * @param {string} packageName
 * @param {string} arch - Architecture.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.remove = function (zogConfig, packageName, arch, callbackDone) {
  var wpkg = new WpkgArgs (zogConfig, callbackDone);
  wpkg.remove (packageName, arch);
};

/**
 * Create the administration directory in the target root.
 * The target root is the destination where are installed the packages.
 * @param {Object} zogConfig
 * @param {string} arch - Architecture.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.createAdmindir = function (zogConfig, arch, callbackDone) {
  var util  = require ('util');
  var fs    = require ('fs');
  var zogFs = require ('xcraft-core-fs');

  /* This control file is used in order to create a new admin directory. */
  var controlFile = path.join (zogConfig.tempRoot, 'control');
  var data = util.format ('Architecture: %s\n' +
                          'Maintainer: "Zog Toolchain" <zog@epsitec.ch>\n' +
                          'Distribution: %s\n',
                          arch, zogConfig.pkgRepository);

  fs.writeFileSync (controlFile, data);

  /* Create the target directory. */
  zogFs.mkdir (path.join (zogConfig.pkgTargetRoot, arch));

  var wpkg = new WpkgArgs (zogConfig, callbackDone);
  wpkg.createAdmindir (controlFile, arch);
};

/**
 * Add a new source in the target installation.
 * A source is needed in order to upgrade the packages in the target root
 * accordingly to the versions in the repository referenced in the source.
 * @param {Object} zogConfig
 * @param {string} sourcePath
 * @param {string} arch - Architecture.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.addSources = function (zogConfig, sourcePath, arch, callbackDone) {
  var list = [];

  var wpkg = new WpkgArgs (zogConfig, function (done) {
    if (!done) {
      callbackDone (false);
      return;
    }

    /* The list array is populated by listSources. */
    if (list.indexOf (sourcePath) >= 0) {
      callbackDone (true);
      return; /* already in the sources.list */
    }

    var wpkg = new WpkgArgs (zogConfig, callbackDone);
    wpkg.addSources (sourcePath, arch);
  });

  wpkg.listSources (arch, list);
};

/**
 * Update the list of available packages from the repository.
 * @param {Object} zogConfig
 * @param {string} arch - Architecture.
 * @param {function(done)} callbackDone
 * @param {boolean} callbackDone.done - True on success.
 */
exports.update = function (zogConfig, arch, callbackDone) {
  var wpkg = new WpkgArgs (zogConfig, callbackDone);
  wpkg.update (arch);
};
