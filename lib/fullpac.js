'use strict';

const watt = require('gigawatts');

module.exports = watt(function* (resp, dep, ignoreOverwatch, next) {
  let cmdMsg = {
    packageArgs: [`${dep},@deps`],
    _ignoreOverwatch: ignoreOverwatch,
  };

  let result = yield resp.command.send('pacman.make', cmdMsg, next);
  if (result.data === resp.events.status.failed) {
    throw 'the command has failed';
  }

  cmdMsg = {
    packageRefs: dep,
    _ignoreOverwatch: ignoreOverwatch,
  };

  /* FIXME: in case of source package, we should check if it's necessary */
  result = yield resp.command.send('pacman.build', cmdMsg, next);
  if (result.data === resp.events.status.failed) {
    throw 'the command has failed';
  }

  /* FIXME: skip install if it's not necessary */
  result = yield resp.command.send('pacman.install', cmdMsg, next);
  if (result.data === resp.events.status.failed) {
    throw 'the command has failed';
  }

  resp.log.info(`${dep} is installed`);
});
