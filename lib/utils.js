'use strict';

var xPlatform    = require ('xcraft-core-platform');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


var checkHost = function (arch, archHost) {
  if (arch === 'all') {
    return true;
  }

  var os = xPlatform.getOs ();
  if (arch === 'source') {
    arch = archHost;
    if (!archHost) {
      return true;
    }
  }

  switch (os) {
  case 'win': {
    return /^mswindows-/.test (arch);
  }
  case 'linux': {
    return /^linux-/.test (arch);
  }
  case 'darwin': {
    return /^darwin-/.test (arch);
  }
  case 'freebsd': {
    return /^freebsd-/.test (arch);
  }
  case 'sunos': {
    return /^solaris-/.test (arch);
  }
  }

  return false;
};

exports.checkArch = function (arch) {
  return pacmanConfig.architectures.indexOf (arch) !== -1;
};

exports.parsePkgRef = function (packageRef) {
  return {
    name: packageRef.replace (/:.*/, ''),
    arch: packageRef.replace (/.*:/, '')
  };
};

exports.checkOsSupport = function (packageName, packageArch, arch) {
  if (packageArch && arch !== packageArch) {
    return false;
  }

  /* Check OS support; we consider that Windows packages can be built only
   * with Windows. The first reason is the post/pre scripts which have not the
   * same name that on unix (.bat suffix under Windows).
   */
  if (!checkHost (arch)) {
    return false;
  }

  var definition = require ('./definition.js');
  var def = definition.load (packageName);
  if (def.architectureHost && def.architectureHost.length) {
    return def.architectureHost.some (function (archHost) {
      return checkHost (arch, archHost);
    });
  }

  return true;
};
