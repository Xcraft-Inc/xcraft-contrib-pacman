'use strict';

const path = require('path');
const watt = require('gigawatts');
const xEtc = require('xcraft-core-etc');
const WpkgHttp = require('./wpkgHttp.js');

exports.getTargetRoot = (distribution, resp) => {
  const xConfig = xEtc(null, resp).load('xcraft');
  const pacmanConfig = xEtc(null, resp).load('xcraft-contrib-pacman');

  if (!distribution) {
    distribution = pacmanConfig.pkgToolchainRepository;
  }

  return distribution !== pacmanConfig.pkgToolchainRepository &&
    distribution !== 'sources/'
    ? path.join(
        xConfig.xcraftRoot,
        'var',
        `prodroot.${distribution.replace('/', '')}`
      )
    : xConfig.pkgTargetRoot;
};

exports.getDebRoot = (distribution, resp) => {
  const xConfig = xEtc(null, resp).load('xcraft');
  const pacmanConfig = xEtc(null, resp).load('xcraft-contrib-pacman');

  if (!distribution) {
    distribution = pacmanConfig.pkgToolchainRepository;
  }

  return distribution !== pacmanConfig.pkgToolchainRepository &&
    distribution !== 'sources/'
    ? path.join(
        xConfig.xcraftRoot,
        'var',
        `wpkg.${distribution.replace('/', '')}`
      )
    : xConfig.pkgDebRoot;
};

let wpkgHttp = null;
exports.wpkgHttp = function () {
  const pacmanConfig = require('xcraft-core-etc')().load(
    'xcraft-contrib-pacman'
  );

  if (!pacmanConfig?.http?.enabled) {
    return null;
  }

  wpkgHttp = new WpkgHttp(
    pacmanConfig?.http?.port,
    pacmanConfig?.http?.hostname
  );
  return wpkgHttp;
};

exports.dispose = watt(function* () {
  if (wpkgHttp) {
    yield wpkgHttp.dispose();
  }
});
