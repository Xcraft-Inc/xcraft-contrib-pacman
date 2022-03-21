'use strict';

module.exports = [
  {
    type: 'checkbox',
    name: 'architectures',
    message: 'supported architectures',
    choices: function () {
      var list = [];

      module.exports[0].default.forEach(function (arch) {
        list.push({
          name: arch,
          checked: true,
        });
      });

      return list;
    },
    default: [
      'mswindows-i386',
      'mswindows-amd64',
      'linux-i386',
      'linux-amd64',
      'linux-aarch64',
      'darwin-i386',
      'darwin-amd64',
      'darwin-aarch64',
      'solaris-i386',
      'solaris-amd64',
      'freebsd-i386',
      'freebsd-amd64',
    ],
  },
  {
    type: 'input',
    name: 'pkgCfgFileName',
    message: 'config file name for wpkg definitions',
    default: 'config.yaml',
  },
  {
    type: 'input',
    name: 'pkgScript',
    message: 'template name for wpkg scripts',
    default: 'script',
  },
  {
    type: 'input',
    name: 'pkgMakeall',
    message: 'make all script name',
    default: 'makeall',
  },
  {
    type: 'input',
    name: 'pkgWPKG',
    message: 'wpkg directory for packages',
    default: 'WPKG',
  },
  {
    type: 'input',
    name: 'pkgToolchainRepository',
    message: 'toolchain repository path',
    default: 'toolchain/',
  },
  {
    type: 'input',
    name: 'pkgIndex',
    message: 'index file for wpkg repositories',
    default: 'index.tar.gz',
  },
  {
    type: 'input',
    name: 'wpkgTemp',
    message: 'temporary directory for wpkg (empty for user temp)',
    default: './var/tmp/',
  },
  {
    type: 'input',
    name: 'stamps',
    message: 'location for build stamps',
    default: './var/xcraft-contrib-pacman/',
  },
  {
    type: 'confirm',
    name: 'http.enabled',
    message: 'enable HTTP server for WPKG repositories',
    default: true,
  },
  {
    type: 'input',
    name: 'http.port',
    message: 'set the HTTP server port for the repositories',
    default: 12321,
  },
  {
    type: 'input',
    name: 'http.hostname',
    message: 'set the HTTP hostname for the repositories',
    default: '0.0.0.0',
  },
];
