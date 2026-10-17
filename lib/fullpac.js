'use strict';

const watt = require('gigawatts');

module.exports = watt(function* (
  resp,
  deps,
  ignoreOverwatch,
  distribution,
  next
) {
  let cmdMsg = {
    packageArgs: [deps.map((dep) => `${dep},@deps`).join(',')],
    _ignoreOverwatch: ignoreOverwatch,
  };

  let result = yield resp.command.send('pacman.make', cmdMsg, next);
  if (result.data === resp.events.status.failed) {
    throw 'the command has failed';
  }

  cmdMsg = {
    packageRefs: deps.join(','),
    distribution,
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

  resp.log.info(
    `${deps.join(', ')} ${deps.length > 1 ? 'are' : 'is'} installed`
  );
});
