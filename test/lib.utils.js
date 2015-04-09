'use strict';

var should    = require ('should'); /* jshint ignore:line */
var xPlatform = require ('xcraft-core-platform');
var utils     = require ('../lib/utils.js');

describe ('xcraft-contrib-pacman/utils', function () {
  describe ('#parsePkgRef ()', function () {
    var packageRef = {
      nameAll:   'namespace+foobar:all',
      nameArch:  'namespace+foobar:linux-amd64',
      nameColon: 'namespace+foobar:',
      nameOnly:  'namespace+foobar',
      archAll:   ':all',
      archOnly:  ':linux-amd64',
      colonOnly: ':',
      empty:     ''
    };

    it ('should have a name and a null architecture', function () {
      utils.parsePkgRef (packageRef.nameAll).should.be.eql ({
        name: 'namespace+foobar',
        arch: null
      });
    });

    it ('should have a name and an architecture', function () {
      utils.parsePkgRef (packageRef.nameArch).should.be.eql ({
        name: 'namespace+foobar',
        arch: 'linux-amd64'
      });
    });

    it ('should have a name and the current architecture', function () {
      utils.parsePkgRef (packageRef.nameColon).should.be.eql ({
        name: 'namespace+foobar',
        arch: xPlatform.getToolchainArch ()
      });

      utils.parsePkgRef (packageRef.nameOnly).should.be.eql ({
        name: 'namespace+foobar',
        arch: xPlatform.getToolchainArch ()
      });
    });

    it ('should have an empty name and no architecture', function () {
      utils.parsePkgRef (packageRef.archAll).should.be.eql ({
        name: '',
        arch: null
      });
    });

    it ('should have an empty name and an architecture', function () {
      utils.parsePkgRef (packageRef.archOnly).should.be.eql ({
        name: '',
        arch: 'linux-amd64'
      });
    });

    it ('should have an empty name and the current architecture', function () {
      utils.parsePkgRef (packageRef.colonOnly).should.be.eql ({
        name: '',
        arch: xPlatform.getToolchainArch ()
      });

      utils.parsePkgRef (packageRef.empty).should.be.eql ({
        name: '',
        arch: xPlatform.getToolchainArch ()
      });
    });
  });
});
