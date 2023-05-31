'use strict';

const {expect} = require('chai');
const make = require('../lib/make.js');

describe('xcraft.pacman.make', function () {
  describe('stamps regex', function () {
    const files = [
      '.gitignore',
      'config.yaml',
      'config.purple.yaml',
      'config.orange.yaml',
      'config.yellow.yaml',
      'config.yellow+green.yaml',
      'config.yellow+red.yaml',
      'patches',
      'patches/001_fix.patch',
      'root',
      'root/package.json',
    ];

    it('standard distribution (use yellow/)', function () {
      const regex = make()._getStampRegex('yellow/');
      const filtered = files.filter((entry) => !regex.test(entry));

      expect(filtered).to.have.same.members([
        /* .gitignore */
        'config.yaml',
        'config.purple.yaml',
        'config.orange.yaml',
        'config.yellow.yaml',
        /* config.yellow+green.yaml */
        /* config.yellow+red.yaml */
        'patches',
        'patches/001_fix.patch',
        'root',
        'root/package.json',
      ]);
    });

    it('standard distribution (use toolchain/)', function () {
      const regex = make()._getStampRegex('toolchain/');
      const filtered = files.filter((entry) => !regex.test(entry));

      expect(filtered).to.have.same.members([
        /* .gitignore */
        'config.yaml',
        'config.purple.yaml',
        'config.orange.yaml',
        'config.yellow.yaml',
        /* config.yellow+green.yaml */
        /* config.yellow+red.yaml */
        'patches',
        'patches/001_fix.patch',
        'root',
        'root/package.json',
      ]);
    });

    it('specific distribution (use yellow+green/)', function () {
      const regex = make()._getStampRegex('yellow+green/');
      const filtered = files.filter((entry) => !regex.test(entry));

      expect(filtered).to.have.same.members([
        /* .gitignore */
        'config.yaml',
        /* config.purple.yaml */
        /* config.orange.yaml */
        /* config.yellow.yaml */
        'config.yellow+green.yaml',
        /* config.yellow+red.yaml */
        'patches',
        'patches/001_fix.patch',
        'root',
        'root/package.json',
      ]);
    });

    it('specific distribution (use yellow+red/)', function () {
      const regex = make()._getStampRegex('yellow+red/');
      const filtered = files.filter((entry) => !regex.test(entry));

      expect(filtered).to.have.same.members([
        /* .gitignore */
        'config.yaml',
        /* config.purple.yaml */
        /* config.orange.yaml */
        /* config.yellow.yaml */
        /* config.yellow+green.yaml */
        'config.yellow+red.yaml',
        'patches',
        'patches/001_fix.patch',
        'root',
        'root/package.json',
      ]);
    });
  });
});
