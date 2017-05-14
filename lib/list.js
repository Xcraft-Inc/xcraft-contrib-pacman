'use strict';

var xFs = require ('xcraft-core-fs');
var definition = require ('./def.js');

/**
 * Return a product packages list.
 *
 * @returns {string[]} The list of packages.
 */
exports.listProducts = function (response) {
  const xcraftConfig = require ('xcraft-core-etc') (null, response).load (
    'xcraft'
  );

  var products = [];
  var packagesDir = xFs.lsdir (xcraftConfig.pkgProductsRoot);

  packagesDir.forEach (function (pkg) {
    var doc = definition.load (pkg, null, response);
    products.push (doc);
  });

  return products;
};
