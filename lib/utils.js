'use strict';

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
