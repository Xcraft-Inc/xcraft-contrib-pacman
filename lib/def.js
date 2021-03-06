'use strict';

var path = require('path');
const fs = require('fs');
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
    make: {},
    build: {},
    install: {},
  },
  data: {
    get: {
      uri: '',
      ref: '',
      out: '',
      externals: true,
    },
    type: 0,
    configure: '',
    rules: {
      type: 0,
      test: 0,
      location: '',
      env: {},
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

function getPackageDefPath(packageName, distribution, resp) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  if (
    /* Case for the config.${distribution}.yaml files */
    distribution &&
    distribution !== pacmanConfig.pkgToolchainRepository
  ) {
    return path.join(
      xcraftConfig.pkgProductsRoot,
      packageName,
      pacmanConfig.pkgCfgFileName.replace(
        /(.*)\.([^.]+)/,
        `$1.${distribution.replace('/', '')}.$2`
      )
    );
  }

  return path.join(
    xcraftConfig.pkgProductsRoot,
    packageName,
    pacmanConfig.pkgCfgFileName
  );
}

function overloadProps(data, props, resp) {
  try {
    if (!props) {
      return data;
    }

    var traversed = traverse(data);

    /* Overload properties accordingly to props. */
    Object.keys(props).forEach(function (prop) {
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
}

exports.loadAll = function (packageName, props, resp) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');

  props = Object.assign({}, props);
  delete props.distribution;

  const packageRoot = path.join(xcraftConfig.pkgProductsRoot, packageName);
  let base = null;
  const list = xFs
    .ls(packageRoot, /\.yaml$/)
    .map((file) => file.replace(/^[^.]*(?:\.([^.]+))?\.[^.]+$/, '$1/'))
    .map((distribution) => {
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
 * @param {string} packageName - Package's name.
 * @param {Object} props - Overloaded properties with values.
 * @param {Object} resp - Bus response helper.
 * @param {string} [distribution] - Distribution's name (null for default).
 * @returns {Object} The package definition.
 */
exports.load = function (packageName, props, resp, distribution) {
  const pacmanConfig = require('xcraft-core-etc')(null, resp).load(
    'xcraft-contrib-pacman'
  );

  let data = clone(initDef);

  if (!packageName) {
    return data;
  }

  packageName = packageName.replace(/(?:-stub|-src|-dev)$/, '');
  const pkgConfig = getPackageDefPath(packageName, null, resp);

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
    const pkgDistribConfig = getPackageDefPath(packageName, distribution, resp);
    try {
      data = _.merge(data, utils.yaml.fromFile(pkgDistribConfig));
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }

    data.distribution = distribution;
  }

  return overloadProps(data, props, resp);
};

/**
 * Update a package definition.
 *
 * @param {string} packageName - Package's name.
 * @param {Object} props - New values.
 * @param {Object} resp - Bus response helper.
 * @param {string} [distribution] - Distribution's name (null for default).
 */
exports.update = function (packageName, props, resp, distribution) {
  const yaml = require('js-yaml');

  packageName = packageName.replace(/(?:-stub|-src)$/, '');
  const pkgConfig = getPackageDefPath(packageName, distribution, resp);
  const packageDef = utils.yaml.fromFile(pkgConfig);
  const data = overloadProps(packageDef, props, resp);
  const yamlPkg = yaml.safeDump(data, {lineWidth: 999});

  fs.writeFileSync(pkgConfig, yamlPkg, 'utf8');
};
