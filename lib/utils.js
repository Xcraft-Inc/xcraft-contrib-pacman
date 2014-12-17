'use strict';

var xPlatform    = require ('xcraft-core-platform');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


exports.checkArch = function (arch) {
  return pacmanConfig.architectures.indexOf (arch) !== -1;
};

exports.parsePkgRef = function (packageRef) {
  return {
    name: packageRef.replace (/:.*/, ''),
    arch: packageRef.replace (/.*:/, '')
  };
};

exports.checkOsSupport = function (packageArch, arch) {
  if (packageArch && arch !== packageArch) {
    return false;
  }

  /* Check OS support; we consider that Windows packages can be built only
   * with Windows. The first reason is the post/pre scripts which have not the
   * same name that on unix (.bat suffix under Windows).
   */
  var os = xPlatform.getOs ();
  if (!/^(all|source)$/.test (arch) &&
      (os === 'win' && !/^mswindows/.test (arch) ||
       os !== 'win' &&  /^mswindows/.test (arch))) {
    return false;
  }

  return true;
};
