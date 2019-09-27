'use strict';

const path = require('path');
const xEtc = require('xcraft-core-etc');

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
