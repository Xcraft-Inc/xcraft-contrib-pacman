'use strict';

var zogFs         = require ('xcraft-core-fs');
var pkgDefinition = require ('./pkgDefinition.js');

/**
 * Return a product packages list.
 * @returns {string[]} The list of packages.
 */
exports.listProducts = function (zogConfig) {
  var products    = [];
  var packagesDir = zogFs.lsdir (zogConfig.pkgProductsRoot);

  packagesDir.forEach (function (pkg) {
    var doc = pkgDefinition.load (zogConfig, pkg);
    products.push (doc);
  });

  return products;
};
