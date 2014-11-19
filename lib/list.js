'use strict';

var xFs           = require ('xcraft-core-fs');
var definition    = require ('./definition.js');
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');

/**
 * Return a product packages list.
 * @returns {string[]} The list of packages.
 */
exports.listProducts = function () {
  var products    = [];
  var packagesDir = xFs.lsdir (xcraftConfig.pkgProductsRoot);

  packagesDir.forEach (function (pkg) {
    var doc = definition.load (pkg);
    products.push (doc);
  });

  return products;
};
