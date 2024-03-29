'use strict';

var inquirer = require('inquirer');
const path = require('path');
const utils = require('xcraft-core-utils');

var xFs = require('xcraft-core-fs');
var xPeon = require('xcraft-contrib-peon');
const xWizard = require('xcraft-core-wizard');
var xcraftConfig = require('xcraft-core-etc')().load('xcraft');
var pacmanConfig = require('xcraft-core-etc')().load('xcraft-contrib-pacman');

/* Version rules by Debian:
 * http://windowspackager.org/documentation/implementation-details/debian-version
 */
var versionRegex = /(|[0-9]+:)([0-9][-+:~.0-9a-zA-Z]*)(|-[+~.0-9a-zA-Z]+)/;

exports.header = [
  {
    type: 'input',
    name: 'package',
    message: 'Package name',
    validate: function (value) {
      /* Naming rules by Debian:
       * Must consist only of lower case letters (a-z), digits (0-9), plus (+)
       * and minus (-) signs, and periods (.). They must be at least two
       * characters long and must start with an alphanumeric character.
       */
      if (!/^[a-z0-9]{1}[a-z0-9+-.]{1,}$/.test(value)) {
        return (
          'Must consist only of lower case letters (a-z), digits (0-9), ' +
          'plus (+) and minus (-) signs, and periods (.). ' +
          'They must be at least two characters long and must ' +
          'start with an alphanumeric character.'
        );
      }

      if (/-(src|dev)$/.test(value)) {
        return (
          "A package name can not be terminated by '-src' or '-dev' which are " +
          'reserved words.'
        );
      }

      return true;
    },
  },
  {
    type: 'input',
    name: 'version',
    message: 'Package version (last -<num> is reserved to the Debian release)',
    validate: function (value) {
      var regex = new RegExp('^' + versionRegex.source + '$');

      if (!value.toString().trim()) {
        return 'Version is mandatory.';
      }

      if (!regex.test(value)) {
        return 'Invalid version';
      }

      return true;
    },
  },
  {
    type: 'confirm',
    name: 'tool',
    message:
      'Is it a tool (if yes, then it can only be installed in the toolchain)',
    default: true,
  },
  {
    type: 'input',
    name: 'distribution',
    message: "distribution's name",
    when: (answers) => !answers.tool,
    filter: (answer) => answer.replace(/([^/]+).*/, '$1/'),
  },
  {
    type: 'input',
    name: 'maintainerName',
    message: "Maintainer's name",
    validate: function (value) {
      if (!value.trim()) {
        return "The maintainer's name is mandatory.";
      }

      return true;
    },
  },
  {
    type: 'input',
    name: 'maintainerEmail',
    message: "Maintainer's email",
    validate: function (value) {
      var mailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

      if (!value.trim()) {
        return 'Email is mandatory.';
      }

      if (!mailRegex.test(value)) {
        return 'Invalid email';
      }

      return true;
    },
  },
  {
    type: 'checkbox',
    name: 'architecture',
    message: 'Package architecture',
    choices: function () {
      var list = [];

      list.push({name: 'all'});
      list.push({name: 'source'});
      list.push(new inquirer.Separator('== Architectures =='));
      pacmanConfig.architectures.forEach(function (arch) {
        list.push({name: arch});
      });

      return list;
    },
    validate: function (value) {
      if (value.length < 1) {
        return 'You must choose at least one topping.';
      }

      if (
        value.length > 1 &&
        value.some(function (arch) {
          return arch === 'source';
        })
      ) {
        return 'A source package can not have other architectures.';
      }

      return true;
    },
    filter: function (answer) {
      if (answer.indexOf('all') !== -1) {
        return ['all'];
      }

      return answer;
    },
  },
  {
    type: 'input',
    name: 'descriptionBrief',
    message: 'Brief description (max 70 characters):',
    validate: function (value) {
      if (value.length > 70) {
        return 'The brief description must not be longer than 70 characters.';
      }

      if (!value.trim()) {
        return 'The brief description is mandatory.';
      }

      return true;
    },
  },
  {
    type: 'input',
    name: 'descriptionLong',
    message: 'Long description',
    loktharType: 'multi-line',
  },
  {
    type: 'input',
    name: 'subPackages',
    message: `Sub-packages list (comma separated, like: 'runtime*,dev,doc')`,
    default: 'runtime*',
    when: (answers) => answers.architecture.indexOf('source') !== -1,
    filter: (answer) => answer.split(','),
  },
  {
    type: 'checkbox',
    name: 'bump',
    message:
      'List of packages to bump (must be rebuilt when this one has changed)',
    choices: function () {
      return xFs.lsdir(xcraftConfig.pkgProductsRoot).reduce((list, dir) => {
        list.push(dir);
        return list;
      }, []);
    },
  },
];

var askdep = function (type) {
  return [
    {
      type: 'confirm',
      name: 'hasDependency',
      message: 'Add a dependency for ' + type,
      default: false,
    },
  ];
};

exports['askdep/make'] = askdep('make');
exports['askdep/install'] = askdep('install');
exports['askdep/build'] = askdep('build');

var dependency = function (type) {
  return [
    {
      type: 'list',
      name: 'dependency/' + type,
      message: "Package's name",
      choices: function () {
        return xFs.lsdir(xcraftConfig.pkgProductsRoot).reduce((list, dir) => {
          list.push(dir);
          const def = utils.yaml.fromFile(
            path.join(
              xcraftConfig.pkgProductsRoot,
              dir,
              pacmanConfig.pkgCfgFileName
            )
          );
          if (def.subpackage) {
            list.push(
              ...def.subpackage
                .filter((sub) => sub.indexOf('*') === -1)
                .map((sub) => sub.replace(/:.*/, ''))
                .map((sub) => `${dir}-${sub}`)
            );
          }
          return list;
        }, []);
      },
    },
    {
      type: 'input',
      name: 'version',
      message:
        'Empty string or range operator (>>, >=, =, <= or <<) with version (like >= 1.0):',
      validate: function (value) {
        var rangeRegex = /((<[<=]|>[>=])|=)/;
        var regex = new RegExp(
          '^(|' + rangeRegex.source + '[ ]{1}' + versionRegex.source + ')$'
        );
        return regex.test(value);
      },
    },
    {
      type: 'checkbox',
      name: 'architecture',
      message: 'Architectures where this dependency must be applied (or empty)',
      choices: () => pacmanConfig.architectures.map((arch) => ({name: arch})),
      filter: (answer) => answer || [],
    },
    {
      type: 'input',
      name: 'subPackages',
      message: 'Sub-packages where this dependency must be associated',
      default: '',
      when: function () {
        return type === 'install';
      },
    },
    {
      type: 'input',
      name: 'external',
      message:
        'Distribution of a package referenced in an external WPKG repository',
      default: '',
      when: function () {
        return type === 'build' || type === 'make';
      },
    },
  ];
};

exports['dependency/make'] = dependency('make');
exports['dependency/install'] = dependency('install');
exports['dependency/build'] = dependency('build');

exports.data = [
  {
    type: 'list',
    name: 'fileType',
    message: 'Type of data',
    choices: function () {
      return Object.keys(xPeon);
    },
  },
  {
    type: 'list',
    name: 'rulesType',
    message: 'How to install (to build)',
    choices: function (answers) {
      return Object.keys(xPeon[answers.fileType]).filter(
        (type) => typeof xPeon[answers.fileType][type] === 'function'
      );
    },
  },
  {
    type: 'input',
    name: 'uri',
    message: 'URI',
    when: function (answers) {
      return answers.rulesType !== 'meta';
    },
  },
  {
    type: 'input',
    name: 'mirrors',
    message: `Mirrors list (comma separated, like: 'https://a.b.c,ftp://a.b.c')`,
    default: '',
    filter: (answer) => (answer ? answer.split(',') : []),
  },
  {
    type: 'input',
    name: 'uriOut',
    message: 'Output basename (keep empty for current URI basename):',
    when: function (answers) {
      if (!answers.uri) {
        return false;
      }

      var url = require('url');
      var uriObj = url.parse(answers.uri);

      switch (uriObj.protocol) {
        case 'http:':
        case 'https:':
        case 'ssh+git:':
        case 'chest:': {
          return true;
        }
      }

      return false;
    },
  },
  {
    type: 'input',
    name: 'uriRef',
    message: 'Branch, tag, commit or empty:',
    when: function (answers) {
      return !!answers.uri;
    },
  },
  {
    type: 'confirm',
    name: 'uriExternals',
    message: 'Clone, checkout externals (like submodules) if any',
    when: function (answers) {
      return !!answers.uri;
    },
  },
  {
    type: 'input',
    name: 'prepareCmd',
    message: 'Prepare src tree step (commands, script, ...):',
    when: function (answers) {
      return answers.fileType === 'src';
    },
  },
  {
    type: 'input',
    name: 'configureCmd',
    message: 'Configure step (commands, script, ...):',
    when: function (answers) {
      return answers.rulesType !== 'meta';
    },
  },
  {
    type: 'list',
    name: 'rulesTest',
    message: 'How to test the build',
    choices: function (answers) {
      return ['none'].concat(Object.keys(xPeon[answers.fileType].test));
    },
    when: (answers) => {
      return answers.fileType === 'src' && xPeon[answers.fileType].test;
    },
  },
  {
    type: 'input',
    name: 'rulesLocation',
    message: 'Installer file name, source directory, executable, ...',
    when: function (answers) {
      return answers.rulesType !== 'meta';
    },
  },
  {
    type: 'input',
    name: 'rulesArgsPostinst',
    message:
      'Arguments (or script if configure and arch != all) for the installer (to install):',
    when: function (answers) {
      return answers.rulesType === 'exec' || answers.rulesType === 'configure';
    },
  },
  {
    type: 'input',
    name: 'rulesArgsPrerm',
    message:
      'Arguments (or script if configure and arch != all) for the installer (to remove):',
    when: function (answers) {
      return answers.rulesType === 'exec' || answers.rulesType === 'configure';
    },
  },
  {
    type: 'input',
    name: 'rulesArgsMakeall',
    message: 'Arguments for `make all`:',
    when: function (answers) {
      return answers.fileType === 'src';
    },
  },
  {
    type: 'input',
    name: 'rulesArgsMaketest',
    message: 'Arguments for `make test`:',
    when: function (answers) {
      return answers.fileType === 'src' && answers.rulesTest !== 'none';
    },
  },
  {
    type: 'input',
    name: 'rulesArgsMakeinstall',
    message: 'Arguments for `make install`:',
    when: function (answers) {
      return answers.fileType === 'src';
    },
  },
  {
    type: 'input',
    name: 'deployCmd',
    message: 'Deploy step (commands, script, ...):',
    when: function (answers) {
      return answers.fileType === 'src';
    },
  },
  {
    type: 'confirm',
    name: 'embedded',
    message: 'Embed data in the package (only if less than 2GB)?',
    when: function (answers) {
      return answers.rulesType !== 'meta';
    },
  },
  {
    type: 'input',
    name: 'runtimeConfigureCmd',
    message:
      'Configure step for binary runtime package (commands, script, ...):',
    when: function (answers) {
      return answers.fileType === 'src';
    },
  },
  {
    type: 'input',
    name: 'registerPath',
    message:
      'Register an unusual location for PATH (keep empty with default PATH):',
    when: function (answers) {
      return answers.rulesType !== 'meta';
    },
  },
  {
    type: 'input',
    name: 'registerPathSub',
    message:
      'Register an unusual location for PATH (subPackages variant as JS Object):',
    when: function (answers) {
      return answers.rulesType !== 'meta';
    },
  },
];

exports.rulesEnv = [
  {
    type: 'input',
    name: 'key1',
    message:
      'Insert the name of a specific environment variable for building (or nothing to continue):',
  },
  {
    type: 'name',
    name: 'value',
    message: 'Value of the environment variable:',
    when: function (answers) {
      return !!answers.key1.trim().length;
    },
  },
];

exports.env = [
  {
    type: 'input',
    name: 'key0',
    message:
      'Insert the name of a specific environment variable (or nothing to continue):',
  },
  {
    type: 'name',
    name: 'value',
    message: 'Value of the environment variable:',
    when: function (answers) {
      return !!answers.key0.trim().length;
    },
  },
];

exports.chest = [
  {
    type: 'confirm',
    name: 'mustUpload',
    message: 'Upload your file to the chest server',
    default: false,
  },
  {
    type: 'input',
    name: 'localPath',
    message: 'Location on the file to upload',
    when: function (answers) {
      return answers.mustUpload;
    },
  },
];

exports.xcraftCommands = () => xWizard.commandify(exports);
