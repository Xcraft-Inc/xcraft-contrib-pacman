'use strict';

var zogFs         = require ('xcraft-core-fs');
var pkgDefinition = require ('./pkgDefinition.js');
var xcraftConfig  = require ('xcraft-core-etc').load ('xcraft');

/**
 * Return a product packages list.
 * @returns {string[]} The list of packages.
 */
exports.listProducts = function () {
  var products    = [];
  var packagesDir = zogFs.lsdir (xcraftConfig.pkgProductsRoot);

  packagesDir.forEach (function (pkg) {
    var doc = pkgDefinition.load (pkg);
    products.push (doc);
  });

  return products;
};
