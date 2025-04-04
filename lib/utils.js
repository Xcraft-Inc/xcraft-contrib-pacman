'use strict';

const path = require('path');
const watt = require('gigawatts');
const colors = require('picocolors').createColors(true);
var xPlatform = require('xcraft-core-platform');
const xFs = require('xcraft-core-fs');
const xUri = require('xcraft-core-uri');

const traverse = require('xcraft-traverse');

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
};

exports.checkArch = function (arch) {
  const pacmanConfig = require('xcraft-core-etc')().load(
    'xcraft-contrib-pacman'
  );
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
  var traverse = require('xcraft-traverse');
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

/**
 * List of distributions (without the specifics).
 *
 * @param {*} packageDef Package's definition
 * @returns {string[]} the list of non-specific distributions
 */
exports.getDistributions = (packageDef) => {
  const xcraftConfig = require('xcraft-core-etc')().load('xcraft');
  const pacmanConfig = require('xcraft-core-etc')().load(
    'xcraft-contrib-pacman'
  );
  return [packageDef.distribution].concat(
    xFs
      .ls(
        path.join(xcraftConfig.pkgProductsRoot, packageDef.name),
        new RegExp(`^${pacmanConfig.pkgCfgFileName.split('.')[0]}.*\\.yaml$`)
      )
      .map((yaml) => yaml.split('.'))
      .filter((list) => list.length === 3)
      .filter((list) => list[1].indexOf('+') === -1)
      .map((list) => `${list[1]}/`)
  );
};

const blink = (text) => `\x1b[5m${text}\x1b[25m`;

exports.errorReporting = (resp) =>
  watt(function* (err, next) {
    if (!err.get('exception').length) {
      return;
    }

    const banner = () =>
      resp.log.err(
        colors.redBright(blink(colors.bold(' ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ '))) +
          colors.whiteBright(
            colors.bgRedBright(colors.bold(' ERROR Reporting '))
          ) +
          colors.redBright(blink(colors.bold(' ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ')))
      );

    try {
      yield resp.command.send('buslog.disable', {modes: ['overwatch']}, next);
      banner();
      err.get('exception').forEach((ex) => {
        ex = ex.toJS();
        const times = ex.time.map((time) =>
          new Date(time).toTimeString().substring(0, 8)
        );
        resp.log.err(
          `${ex.err} ${colors.blackBright('//')} ${colors.yellowBright(
            colors.bold(times)
          )}`
        );
      });
      banner();
    } finally {
      yield resp.command.send('buslog.enable', {modes: ['overwatch']}, next);
    }
  });

exports.makeGetObj = (packageDef) => {
  const getObj = packageDef.data.get;

  getObj.uri = xUri.realUri(
    exports.injectThisPh(packageDef, packageDef.data.get.uri),
    packageDef.name
  );
  getObj.mirrors = packageDef.data.get.mirrors.map((mirror) =>
    xUri.realUri(exports.injectThisPh(packageDef, mirror), packageDef.name)
  );

  getObj.ref = exports.injectThisPh(packageDef, packageDef.data.get.ref);
  getObj.out = exports.injectThisPh(packageDef, packageDef.data.get.out);
  return getObj;
};
