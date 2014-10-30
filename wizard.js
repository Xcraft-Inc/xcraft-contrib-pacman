'use strict';

var inquirer  = require ('inquirer');
var zogFs     = require ('xcraft-core-fs');
var zogPeon   = require ('xcraft-core-peon');
var busClient = require ('xcraft-core-busclient');
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig  = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


/* Version rules by Debian:
 * http://windowspackager.org/documentation/implementation-details/debian-version
 */
var versionRegex = /(|[0-9]+:)([0-9][-+:~.0-9a-zA-Z]*)(|-[+~.0-9a-zA-Z]+)/;

exports.header = [{
  type: 'input',
  name: 'package',
  message: 'Package name',
  validate: function (value) {
    /* Naming rules by Debian:
     * Must consist only of lower case letters (a-z), digits (0-9), plus (+)
     * and minus (-) signs, and periods (.). They must be at least two
     * characters long and must start with an alphanumeric character.
     */
    if (!/^[a-z0-9]{1}[a-z0-9+-.]{1,}$/.test (value)) {
      return 'Must consist only of lower case letters (a-z), digits (0-9), ' +
             'plus (+) and minus (-) signs, and periods (.). ' +
             'They must be at least two characters long and must ' +
             'start with an alphanumeric character.';
    }

    return true;
  }
}, {
  type: 'input',
  name: 'version',
  message: 'Package version',
  validate: function (value) {
    var regex = new RegExp ('^' + versionRegex.source + '$');

    if (!value.toString ().trim ()) {
      return 'Version is mandatory.';
    }

    if (!regex.test (value)) {
      return 'Invalid version';
    }

    return true;
  }
}, {
  type: 'input',
  name: 'maintainerName',
  message: 'Maintainer\'s name',
  validate: function (value) {
    if (!value.trim ()) {
      return 'The maintainer\'s name is mandatory.';
    }

    return true;
  }
}, {
  type: 'input',
  name: 'maintainerEmail',
  message: 'Maintainer\'s email',
  validate: function (value) {
    var mailRegex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

    if (!value.trim ()) {
      return 'Email is mandatory.';
    }

    if (!mailRegex.test (value)) {
      return 'Invalid email';
    }

    return true;
  }
}, {
  type: 'checkbox',
  name: 'architecture',
  message: 'Host architecture',
  choices: function () {
    var list = [];

    list.push ({name: 'all'});
    list.push ({name: 'source'});
    list.push (new inquirer.Separator ('== Architectures =='));
    pacmanConfig.architectures.forEach (function (arch) {
      list.push ({name: arch});
    });

    return list;
  },
  validate: function (value) {
    if (value.length < 1) {
      return 'You must choose at least one topping.';
    }

    return true;
  },
  filter: function (answer) {
    if (answer.indexOf ('all') !== -1) {
      return ['all'];
    }

    return answer;
  }
}, {
  type: 'input',
  name: 'descriptionBrief',
  message: 'Brief description (max 70 characters):',
  validate: function (value) {
    if (value.length > 70) {
      return 'The brief description must not be longer than 70 characters.';
    }

    if (!value.trim ()) {
      return 'The brief description is mandatory.';
    }

    return true;
  }
}, {
  type: 'input',
  name: 'descriptionLong',
  message: 'Long description',
  loktharType : 'multi-line'
}];

exports.askdep = [{
  type: 'confirm',
  name: 'hasDependency',
  message: 'Add a dependency',
  default: false
}];

exports.dependency = [{
  type: 'rawlist',
  name: 'dependency',
  message: 'Package\'s name',
  choices: function () {
    return zogFs.lsdir (xcraftConfig.pkgProductsRoot);
  }
}, {
  type: 'input',
  name: 'version',
  message: 'Empty string or range operator (>>, >=, =, <= or <<) with version (like >= 1.0):',
  validate: function (value) {
    var rangeRegex = /((<[<=]|>[>=])|=)/;
    var regex = new RegExp ('^(|' + rangeRegex.source + '[ ]{1}' + versionRegex.source + ')$');
    return regex.test (value);
  }
}];

exports.data = [{
  type: 'input',
  name: 'uri',
  message: 'URI'
}, {
  type: 'list',
  name: 'fileType',
  message: 'Type of data',
  choices: function () {
    var list = [];

    Object.keys (zogPeon).forEach (function (type) {
      list.push ({
        name: type
      });
    });

    return list;
  }
}, {
  type: 'list',
  name: 'rulesType',
  message: 'How to install (to build)',
  choices: function (answers) {
    var list = [];

    Object.keys (zogPeon[answers.fileType]).forEach (function (type) {
      list.push ({
        name: type
      });
    });

    return list;
  }
}, {
  type: 'input',
  name: 'rulesLocation',
  message: 'Installer file name, source directory ,...',
  when: function (answers) {
    return /(exec|make)/.test (answers.rulesType);
  }
}, {
  type: 'input',
  name: 'rulesArgsInstall',
  message: 'Arguments for the installer (to install):',
  when: function (answers) {
    return answers.rulesType === 'exec';
  }
}, {
  type: 'input',
  name: 'rulesArgsRemove',
  message: 'Arguments for the installer (to remove):',
  when: function (answers) {
    return answers.rulesType === 'exec';
  }
}, {
  type: 'confirm',
  name: 'embedded',
  message: 'Embed data in the package (only if less than 1GB)?'
}];

exports.chest = [{
  type: 'confirm',
  name: 'mustUpload',
  message: 'Upload your file to the chest server',
  default: false
}, {
  type: 'input',
  name: 'localPath',
  message: 'Location on the file to upload',
  when: function (answers) {
    return answers.mustUpload;
  }
}];

exports.xcraftCommands = function () {
  var list = [];

  var tryPushFunction = function (fieldDef, category, funcName, resultEventName) {
    if (!fieldDef.hasOwnProperty (funcName)) {
      return;
    }

    /* generating cmd and result event name */
    var cmdName = category + '.' + fieldDef.name + '.' + funcName;

    var evtName = 'wizard.' +
                  category + '.' +
                  fieldDef.name + '.' +
                  resultEventName;

    /* Indicate to lokthar that a command for validation is available
     * and corresponding result event.
     */
    fieldDef.loktharCommands['wizard.' + cmdName] = evtName;
    list.push ({
      name   : cmdName,
      desc   : '',
      params : '',
      handler: function (value) {
        /* execute function */
        var result = fieldDef[funcName] (value.data);
        console.log (funcName + ': ' + result);
        busClient.events.send (evtName, result);
      }
    });
  };

  var extractCommandsHandlers = function (category) {
    var fields = exports[category];

    Object.keys (fields).forEach (function (index) {
      var fieldDef = fields[index];
      fieldDef.loktharCommands = {};

      tryPushFunction (fieldDef, category, 'validate', 'validated');
      tryPushFunction (fieldDef, category, 'choices',  'choices.loaded');
      tryPushFunction (fieldDef, category, 'filter',   'filtered');
      tryPushFunction (fieldDef, category, 'when',   'displayed');
    });
  };

  /* extacts cmds handlers for each category */
  extractCommandsHandlers ('header');
  extractCommandsHandlers ('askdep');
  extractCommandsHandlers ('dependency');
  extractCommandsHandlers ('data');
  extractCommandsHandlers ('chest');

  return list;
};
