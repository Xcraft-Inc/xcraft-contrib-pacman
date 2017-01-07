'use strict';

var path = require ('path');

const _          = require ('lodash');
const clone      = require ('clone');
var traverse     = require ('traverse');
var utils        = require ('xcraft-core-utils');


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
      test: 0,
      location: '',
      args: {
        postinst: '',
        prerm: '',
        makeall: '',
        maketest: '',
        makeinstall: ''
      }
    },
    deploy: '',
    env: {
      path: [],
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
 * @param {Object} response
 * @returns {Object} The package definition.
 */
exports.load = function (packageName, props, response) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load ('xcraft');
  const pacmanConfig = require ('xcraft-core-etc') (null, response).load ('xcraft-contrib-pacman');

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
      response.log.warn ('the package %s does not exists', packageName);
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
      response.log.verb ('overload property %s with the value %s', prop, props[prop]);
      traversed.set (path, props[prop]);
    }
  });

  return data;
};
