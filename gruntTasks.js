'use strict';

var moduleName = 'grunt';

module.exports = function (grunt) {
  var path         = require ('path');
  var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
  var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');
  var zogLog       = require ('xcraft-core-log') (moduleName);

  var initNewer = function () {
    var zogFs      = require ('xcraft-core-fs');
    var pkgControl = require ('./pkgControl.js');

    var list = {};
    var srcYaml = zogFs.lsdir (xcraftConfig.pkgProductsRoot);

    /* Loop for each package available in the products directory. */
    srcYaml.forEach (function (packageName) {
      var destControl = pkgControl.controlFiles (packageName, null, false);

      /* Loop for each control file path. */
      destControl.forEach (function (controlFile) {
        list[packageName + '/' + controlFile.arch] = {
          src: path.join (xcraftConfig.pkgProductsRoot, packageName, pacmanConfig.pkgCfgFileName),
          dest: controlFile.control,
          options: {
            tasks: ['zogMake:' + packageName + '/' + controlFile.arch]
          }
        };
      });
    });

    return list;
  };

  grunt.initConfig ({
    zogMake: {},
    newer: initNewer ()
  });

  grunt.loadNpmTasks ('grunt-newer-explicit');

  grunt.registerTask ('zogMake', 'Task to make control files on newer versions.', function (target) {
    var pkgMake    = require ('./pkgMake.js');

    var done = this.async ();
    var packageName = target.replace (/\/.*/, '');
    var arch        = target.replace (/.*\//, '');

    zogLog.info ('make the control file for ' + packageName + ' on ' + arch);

    pkgMake.package (packageName, arch, function (error) {
      done (error);
    });
  });
};
