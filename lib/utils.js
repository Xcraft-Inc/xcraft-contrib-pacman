'use strict';

const path = require('path');
const clc = require('cli-color');
var xPlatform = require('xcraft-core-platform');
const xFs = require('xcraft-core-fs');
var pacmanConfig = require('xcraft-core-etc')().load('xcraft-contrib-pacman');
const xcraftConfig = require('xcraft-core-etc')().load('xcraft');

const traverse = require('traverse');

/**
 * Check if the \p arch is compatible with the build system.
 *
 * @param {string} arch - Package's architecture.
 * @returns {boolean} - True if compatible.
 */
var checkHost = function (arch) {
  if (/^(all|source)$/.test(arch)) {
    return true;
  }

  /* Check OS support; we consider that Windows packages can be built only
   * with Windows. The first reason is the post/pre scripts which have not the
   * same name that on unix (.bat suffix under Windows).
   */
  var os = xPlatform.getOs();
  switch (os) {
    case 'win': {
      return /^mswindows-/.test(arch);
    }
    default: {
      return !/^mswindows-/.test(arch);
    }
  }

  return false;
};

exports.checkArch = function (arch) {
  return pacmanConfig.architectures.indexOf(arch) !== -1;
};

exports.parsePkgRef = function (packageRef) {
  if (!packageRef) {
    packageRef = '';
  }

  var name = packageRef.replace(/:.*/, '');
  var arch = packageRef.replace(/.*:/, '');

  if (!arch.length || arch === name) {
    arch = xPlatform.getToolchainArch();
  } else if (arch === 'all') {
    arch = null;
  }

  return {
    name: name,
    arch: arch,
  };
};

exports.checkOsSupport = function (packageName, packageArch, packageDef, arch) {
  if (packageArch && !/^(all|source)$/.test(arch) && arch !== packageArch) {
    return false;
  }

  return checkHost(arch);
};

exports.injectThisPh = function (packageDef, data) {
  var traverse = require('traverse');
  var xPh = require('xcraft-core-placeholder');

  var ph = new xPh.Placeholder();

  var traversed = traverse(packageDef);
  traversed.paths().forEach(function (p) {
    var key = p.join('.').toUpperCase();
    var value = traversed.get(p);

    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      return;
    }

    ph.set(key, value);
  });

  return ph.inject('THIS', data);
};

exports.flatten = function (object) {
  const traversed = traverse(object);

  let paths = traversed.paths();
  const flat = {};

  paths.forEach((p) => {
    const val = traversed.get(p);
    if (typeof val !== 'object') {
      flat[p.join('.')] = val;
    }
  });

  return flat;
};

exports.getDistributions = (packageDef) => {
  return [packageDef.distribution].concat(
    xFs
      .ls(
        path.join(xcraftConfig.pkgProductsRoot, packageDef.name),
        new RegExp(`^${pacmanConfig.pkgCfgFileName.split('.')[0]}.*\\.yaml$`)
      )
      .map((yaml) => yaml.split('.'))
      .filter((list) => list.length === 3)
      .map((list) => `${list[1]}/`)
  );
};

exports.errorReporting = (resp, cnt = 1) => (err) => {
  err.get('exception').forEach((ex) => {
    ex = ex.toJS();
    resp.log.dbg(
      clc.whiteBright.bgRed.bold(
        `//////////////////// ERROR Reporting #${cnt++} ////////////////////`
      )
    );
    resp.log.dbg(
      `${clc.yellowBright.bold(ex.mod)} @ ${clc.yellowBright.bold(
        ex.time.join(', ')
      )}\n${ex.err}`
    );
  });
};
