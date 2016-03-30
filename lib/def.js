'use strict';

var moduleName = 'pacman/def';

var path = require ('path');

const _          = require ('lodash');
const clone      = require ('clone');
var traverse     = require ('traverse');
var utils        = require ('xcraft-core-utils');
var xcraftConfig = require ('xcraft-core-etc') ().load ('xcraft');
var pacmanConfig = require ('xcraft-core-etc') ().load ('xcraft-contrib-pacman');
var xLog         = require ('xcraft-core-log') (moduleName);


const initDef = {
  subpackage: [],
  name: '',
  version: '',
  distribution: '',
  maintainer: {
    name: '',
    email: ''
  },
  architecture: [],
  description: {
    brief: '',
    long: ''
  },
  dependency: {
    build: {},
    install: {}
  },
  data: {
    get: {
      uri: '',
      ref: '',
      out: ''
    },
    type: 0,
    configure: '',
    rules: {
      type: 0,
      location: '',
      args: {
        postinst: '',
        prerm: '',
        makeall: '',
        makeinstall: ''
      }
    },
    deploy: '',
    env: {
      path: [],
      ldpath: [],
      other: {}
    },
    embedded: true,
    runtime: {
      configure: ''
    }
  }
};

/**
 * Load a package definition.
 *
 * @param {string} packageName
 * @param {Object} props - Overloaded properties with values.
 * @returns {Object} The package definition.
 */
exports.load = function (packageName, props) {
  let data = clone (initDef);

  if (!packageName) {
    return data;
  }

  packageName = packageName.replace (/-src$/, '');

  var pkgConfig = path.join (xcraftConfig.pkgProductsRoot,
                             packageName,
                             pacmanConfig.pkgCfgFileName);

  try {
    data = _.merge (data, utils.yaml.fromFile (pkgConfig));
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      xLog.warn ('the package %s does not exists', packageName);
    }
  }

  if (!props) {
    return data;
  }

  var traversed = traverse (data);

  /* Overload properties accordingly to props. */
  Object.keys (props).forEach (function (prop) {
    var path = prop.split ('.');
    if (traversed.has (path)) {
      xLog.verb ('overload property %s with the value %s', prop, props[prop]);
      traversed.set (path, props[prop]);
    }
  });

  return data;
};
