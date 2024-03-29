'use strict';

var xFs = require('xcraft-core-fs');
var definition = require('./def.js');

/**
 * Return a product packages list.
 *
 * @returns {string[]} The list of packages.
 */
exports.listProducts = function (resp) {
  const xcraftConfig = require('xcraft-core-etc')(null, resp).load('xcraft');

  var products = [];
  var packagesDir = xFs.lsdir(xcraftConfig.pkgProductsRoot);

  packagesDir.forEach(function (pkg) {
    var doc = definition.load(pkg, null, resp);
    products.push({
      Name: doc.name,
      Version: doc.version,
      Distribution: doc.distribution,
      Architecture: doc.architecture.join(', '),
    });
  });

  return products;
};
