'use strict';

var path = require('path');

const _ = require('lodash');
const clone = require('clone');
var traverse = require('traverse');
var utils = require('xcraft-core-utils');
const xFs = require('xcraft-core-fs');

const initDef = {
  subpackage: [],
  name: '',
  version: '',
  distribution: '',
  maintainer: {
    name: '',
    email: '',
  },
  architecture: [],
  description: {
    brief: '',
    long: '',
  },
  dependency: {
    build: {},
    install: {},
  },
  data: {
    get: {
      uri: '',
      ref: '',
      out: '',
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
        makeinstall: '',
      },
    },
    deploy: '',
    env: {
      path: [],
      other: {},
    },
    embedded: true,
    runtime: {
      configure: '',
    },
  },
};

exports.loadAll = function(packageName, props, resp) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');

  props = Object.assign({}, props);
  delete props.distribution;

  const packageRoot = path.join(xcraftConfig.pkgProductsRoot, packageName);
  let base = null;
  const list = xFs
    .ls(packageRoot, /\.yaml$/)
    .map(file => file.replace(/^[^.]*(?:\.([^.]+))?\.[^.]+$/, '$1/'))
    .map(distribution => {
      const def = exports.load(
        packageName,
        props,
        resp,
        distribution === '/' ? null : distribution
      );

      if (distribution === '/') {
        base = def.distribution;
      }

      return def;
    })
    .reduce((map, def) => {
      map[def.distribution] = def;
      return map;
    }, {});

  list._base = base;
  return list;
};

/**
 * Load a package definition.
 *
 * @param {string} packageName
 * @param {Object} props - Overloaded properties with values.
 * @param {Object} resp
 * @param {string} [distribution] - Distribution's name (null for default).
 * @returns {Object} The package definition.
 */
exports.load = function(packageName, props, resp, distribution) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  let data = clone(initDef);

  if (!packageName) {
    return data;
  }

  packageName = packageName.replace(/(?:-stub|-src)$/, '');

  var pkgConfig = path.join(
    xcraftConfig.pkgProductsRoot,
    packageName,
    pacmanConfig.pkgCfgFileName
  );

  try {
    data = _.merge(data, utils.yaml.fromFile(pkgConfig));
  } catch (ex) {
    if (ex.code === 'ENOENT') {
      resp.log.warn('the package %s does not exists', packageName);
    } else {
      throw ex;
    }
  }

  /* Check for distribution overloads */
  if (!distribution) {
    /* Case where we use only the config.yaml file */
    distribution = data.distribution;
  } else if (
    /* Case for the config.${distribution}.yaml files */
    distribution &&
    distribution !== pacmanConfig.pkgToolchainRepository
  ) {
    const pkgDistribConfig = path.join(
      xcraftConfig.pkgProductsRoot,
      packageName,
      pacmanConfig.pkgCfgFileName.replace(
        /(.*)\.([^.]+)/,
        `$1.${distribution.replace('/', '')}.$2`
      )
    );
    try {
      data = _.merge(data, utils.yaml.fromFile(pkgDistribConfig));
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }

    data.distribution = distribution;
  }

  try {
    if (!props) {
      return data;
    }

    var traversed = traverse(data);

    /* Overload properties accordingly to props. */
    Object.keys(props).forEach(function(prop) {
      var path = prop.split('.');
      path.forEach((v, i) => {
        if (!isFinite(v)) {
          return;
        }
        const loc = path.slice(0, i);
        if (!traversed.has(loc)) {
          traversed.set(loc, []);
        }
      });

      resp.log.verb(
        'overload property %s with the value %s',
        prop,
        props[prop]
      );
      traversed.set(path, props[prop]);
    });
  } finally {
    data.version = data.version.toString();
  }

  return data;
};
