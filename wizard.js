'use strict';

var inquirer = require ('inquirer');

var xFs          = require ('xcraft-core-fs');
var xPeon        = require ('xcraft-contrib-peon');
var busClient    = require ('xcraft-core-busclient').getGlobal ();
var xcraftConfig = require ('xcraft-core-etc').load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc').load ('xcraft-contrib-pacman');


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

    if (/-src$/.test (value)) {
      return 'A package name can not be terminated by \'-src\' which is ' +
             'a reserved word.';
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
  type: 'confirm',
  name: 'tool',
  message: 'Is it a tool (if yes, then it can only be installed in the toolchain)',
  default: true
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
  message: 'Package architecture',
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

    if (value.length > 1 && value.some (function (arch) {
      return arch === 'source';
    })) {
      return 'A source package can not have other architectures.';
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
  loktharType: 'multi-line'
}];

var askdep = function (type) {
  return [{
    type: 'confirm',
    name: 'hasDependency',
    message: 'Add a dependency for ' + type,
    default: false
  }];
};

exports['askdep/install'] = askdep ('install');
exports['askdep/build']   = askdep ('build');

var dependency = function (type) {
  return [{
    type: 'list',
    name: 'dependency/' + type,
    message: 'Package\'s name',
    choices: function () {
      return xFs.lsdir (xcraftConfig.pkgProductsRoot);
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
  }, {
    type: 'checkbox',
    name: 'architecture',
    message: 'Architectures where this dependency must be applied (or empty)',
    choices: function () {
      var list = [];

      list.push ({name: 'all'});
      list.push (new inquirer.Separator ('== Architectures =='));
      pacmanConfig.architectures.forEach (function (arch) {
        list.push ({name: arch});
      });

      return list;
    },
    filter: function (answer) {
      if (answer.indexOf ('all') !== -1) {
        return [];
      }

      return answer;
    },
    when: false /* WIP */
  }];
};

exports['dependency/install'] = dependency ('install');
exports['dependency/build']   = dependency ('build');

exports.data = [{
  type: 'list',
  name: 'fileType',
  message: 'Type of data',
  choices: function () {
    var list = [];

    Object.keys (xPeon).forEach (function (type) {
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

    Object.keys (xPeon[answers.fileType]).forEach (function (type) {
      list.push ({
        name: type
      });
    });

    return list;
  }
}, {
  type: 'input',
  name: 'uri',
  message: 'URI',
  when: function (answers) {
    return answers.rulesType !== 'meta';
  }
}, {
  type: 'input',
  name: 'uriOut',
  message: 'Output basename (keep empty for current URI basename):',
  when: function (answers) {
    if (!answers.uri) {
      return false;
    }

    var url = require ('url');
    var uriObj = url.parse (answers.uri);

    switch (uriObj.protocol) {
    case 'http:':
    case 'https:':
    case 'chest:': {
      return true;
    }
    }

    return false;
  }
}, {
  type: 'input',
  name: 'uriRef',
  message: 'Branch, tag, commit or empty:',
  when: function (answers) {
    return answers.fileType === 'src';
  }
}, {
  type: 'input',
  name: 'configureCmd',
  message: 'Configure step (commands, script, ...):',
  when: function (answers) {
    return answers.rulesType !== 'meta';
  }
}, {
  type: 'input',
  name: 'rulesLocation',
  message: 'Installer file name, source directory, executable, ...',
  when: function (answers) {
    return answers.rulesType !== 'meta';
  }
}, {
  type: 'input',
  name: 'rulesArgsPostinst',
  message: 'Arguments for the installer (to install):',
  when: function (answers) {
    return answers.rulesType === 'exec';
  }
}, {
  type: 'input',
  name: 'rulesArgsPrerm',
  message: 'Arguments for the installer (to remove):',
  when: function (answers) {
    return answers.rulesType === 'exec';
  }
}, {
  type: 'input',
  name: 'rulesArgsMakeall',
  message: 'Arguments for `make all`:',
  when: function (answers) {
    return answers.fileType === 'src';
  }
}, {
  type: 'input',
  name: 'rulesArgsMakeinstall',
  message: 'Arguments for `make install`:',
  when: function (answers) {
    return answers.fileType === 'src';
  }
}, {
  type: 'input',
  name: 'deployCmd',
  message: 'Deploy step (commands, script, ...):',
  when: function (answers) {
    return answers.fileType === 'src';
  }
}, {
  type: 'confirm',
  name: 'embedded',
  message: 'Embed data in the package (only if less than 1GB)?',
  when: function (answers) {
    return answers.rulesType !== 'meta';
  }
}, {
  type: 'input',
  name: 'runtimeConfigureCmd',
  message: 'Configure step for binary runtime package (commands, script, ...):',
  when: function (answers) {
    return answers.fileType === 'src';
  }
}, {
  type: 'input',
  name: 'registerPath',
  message: 'Register an unusual location for PATH (keep empty with default PATH):',
  when: function (answers) {
    if (answers.fileType === 'src') {
      return false;
    }

    return answers.rulesType !== 'meta';
  }
}, {
  type: 'input',
  name: 'registerLDPath',
  message: 'Register an unusual location for (DY)LD_LIBARY_PATH (or nothing to continue):',
  when: function (answers) {
    if (answers.fileType === 'src') {
      return false;
    }

    return answers.rulesType !== 'meta';
  }
}];

exports.env = [{
  type: 'input',
  name: 'key',
  message: 'Insert the name of a specific environment variable (or nothing to continue):'
}, {
  type: 'name',
  name: 'value',
  message: 'Value of the environment variable:',
  when: function (answers) {
    return !!answers.key.trim ().length;
  }
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
  var cmd = {};

  var tryPushFunction = function (fieldDef, category, funcName) {
    if (!fieldDef.hasOwnProperty (funcName)) {
      return;
    }

    /* generating cmd and result event name */
    var cmdName = category + '.' + fieldDef.name + '.' + funcName;

    var evtName = `wizard.${category}.${fieldDef.name}.${funcName}.finished`;

    /* Indicate to lokthar that a command for validation is available
     * and corresponding result event.
     */
    fieldDef.loktharCommands['wizard.' + cmdName] = evtName;
    cmd[cmdName] = function (value) {
      /* execute function */
      var result = fieldDef[funcName] (value.data);
      busClient.events.send (evtName, result);
    };
  };

  var extractCommandsHandlers = function (category) {
    var fields = exports[category];

    Object.keys (fields).forEach (function (index) {
      var fieldDef = fields[index];
      fieldDef.loktharCommands = {};

      tryPushFunction (fieldDef, category, 'validate');
      tryPushFunction (fieldDef, category, 'choices');
      tryPushFunction (fieldDef, category, 'filter');
      tryPushFunction (fieldDef, category, 'when');
    });
  };

  /* extacts cmds handlers for each category */
  Object.keys (exports).forEach (function (exp) {
    if (exp !== 'xcraftCommands') {
      extractCommandsHandlers (exp);
    }
  });

  return {
    handlers: cmd,
    rc: null
  };
};
