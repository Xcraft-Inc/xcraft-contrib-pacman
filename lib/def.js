'use strict';

var path = require('path');
const fs = require('fs');
const _ = require('lodash');
const clone = require('clone');
var traverse = require('xcraft-traverse');
var utils = require('xcraft-core-utils');
const xFs = require('xcraft-core-fs');
const yaml = require('js-yaml');

const initDef = {
  subpackage: [],
  name: '',
  version: '',
  $version: '',
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
  bump: [],
  dependency: {
    install: {},
    build: {},
    make: {},
  },
  data: {
    get: {
      uri: '',
      mirrors: [],
      ref: '',
      $ref: '',
      out: '',
      externals: true,
      prepare: '',
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
        maketest: '',
        makeinstall: '',
      },
      test: 0,
      env: {},
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

  const pkgConfig = path.join(
    xcraftConfig.pkgProductsRoot,
    packageName,
    pacmanConfig.pkgCfgFileName
  );
  let pkgDistribConfig = '';

  if (
    /* Case for the config.${distribution}.yaml files */
    distribution &&
    distribution !== pacmanConfig.pkgToolchainRepository
  ) {
    pkgDistribConfig = path.join(
      xcraftConfig.pkgProductsRoot,
      packageName,
      pacmanConfig.pkgCfgFileName.replace(
        /(.*)\.([^.]+)/,
        `$1.${distribution.replace('/', '')}.$2`
      )
    );
  }

  return {base: pkgConfig, distrib: pkgDistribConfig};
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
    if (data.version) {
      data.version = data.version.toString();
    }
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

exports.getBasePackageDef = function (packageName, resp) {
  let pkgDef = {};
  let origPackageName = packageName;

  for (let i = 2; i > 0; --i) {
    packageName = packageName.replace(/(?:-stub|-src|-dev)$/, '');
    const pkgConfig = getPackageDefPath(packageName, null, resp).base;

    try {
      pkgDef = utils.yaml.fromFile(pkgConfig);
      break;
    } catch (ex) {
      if (ex.code === 'ENOENT') {
        if (i === 1) {
          resp.log.warn('the package %s does not exists', origPackageName);
        } else {
          packageName = packageName.replace(/-[^-]+$/, '');
        }
      } else {
        throw ex;
      }
    }
  }

  /* Look for sub-package */
  if (origPackageName !== packageName) {
    const subPackage = origPackageName.substring(packageName.length + 1);
    if (
      !pkgDef.subpackage ||
      !pkgDef.subpackage.some((sub) => sub.split(':')[0] === subPackage)
    ) {
      resp.log.warn(
        'the subpackage %s (for %s) does not exists',
        subPackage,
        packageName
      );
    }
  }

  return pkgDef;
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

  const pkgDef = exports.getBasePackageDef(packageName, resp);
  packageName = pkgDef.name;

  data = _.merge(data, pkgDef);

  /* Check for distribution overloads */
  if (!distribution) {
    /* Case where we use only the config.yaml file */
    distribution = data.distribution;
  } else if (
    /* Case for the config.${distribution}.yaml files */
    distribution &&
    distribution !== pacmanConfig.pkgToolchainRepository
  ) {
    const pkgDistribConfig = getPackageDefPath(packageName, distribution, resp)
      .distrib;
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
  packageName = packageName.replace(/(?:-stub|-src)$/, '');

  const pkgConfigs = getPackageDefPath(packageName, distribution, resp);
  const packageDef = utils.yaml.fromFile(pkgConfigs.base);
  const isSpecificDistrib = distribution && distribution.indexOf('+') !== -1;

  props = clone(props);

  if (isSpecificDistrib) {
    let packageDistribDef = {};
    try {
      packageDistribDef = utils.yaml.fromFile(pkgConfigs.distrib);
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
    const data = overloadProps(packageDistribDef, props, resp);
    exports.save(data, pkgConfigs.distrib, resp);
    return;
  }

  if (distribution) {
    try {
      const packageDistribDef = utils.yaml.fromFile(pkgConfigs.distrib);
      const _props = {};
      for (const prop in props) {
        if (!prop.startsWith('data.')) {
          continue;
        }
        if (
          prop.startsWith('data.get.') ||
          prop === 'data.type' ||
          prop === 'data.embedded'
        ) {
          continue;
        }
        _props[prop] = props[prop];
        delete props[prop];
      }
      const data = overloadProps(packageDistribDef, _props, resp);
      exports.save(data, pkgConfigs.distrib, resp);
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }

  const data = overloadProps(packageDef, props, resp);
  exports.save(data, pkgConfigs.base, resp);
};

function cleanDef(packageDef) {
  /* Do not keep empty subpackage list (it looks like not a src package) */
  if (packageDef?.subpackage?.length === 0) {
    delete packageDef.subpackage;
  }

  /* Remove empty list of dependencies */
  for (const depType of ['install', 'build', 'make']) {
    if (packageDef?.dependency?.[depType]) {
      if (Object.keys(packageDef.dependency[depType]).length === 0) {
        delete packageDef.dependency[depType];
        delete packageDef.data.rules.args.makeall;
        delete packageDef.data.rules.args.maketest;
        delete packageDef.data.rules.args.makeinstall;
        delete packageDef.data.rules.test;
        delete packageDef.data.deploy;
        delete packageDef.data.runtime;
      }
    }
  }

  return packageDef;
}

exports.save = function (packageDef, pkgConfig, resp) {
  if (packageDef.version) {
    packageDef.$version = packageDef.version
      .replace(/^[0-9]+:/, '') // epoch
      .replace(/-[0-9]+$/, '') // package version
      .replace('~', '-'); //      pre-release
  }

  if (!pkgConfig) {
    pkgConfig = getPackageDefPath(packageDef.name, null, resp).base;
  }

  cleanDef(packageDef);

  const yamlPkg = yaml.safeDump(packageDef, {lineWidth: 999});
  fs.writeFileSync(pkgConfig, yamlPkg, 'utf8');
};

exports.bumpPackageVersion = function (version) {
  if (/-[0-9]+$/.test(version)) {
    return version.replace(/-([0-9]+$)/, (_, ver) => `-${parseInt(ver) + 1}`);
  }
  return version + '-1';
};
