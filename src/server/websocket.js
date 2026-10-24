'use strict';

const { Server } = require('socket.io');
const configStore = require('../server/configStore');

/**
 * Real-time glue between the admin console and every mirror display client.
 * Config is the only thing pushed over the socket - weather/score data stays
 * on cached REST polling (see routes/api.js) since that's where caching and
 * upstream rate-limit protection already live.
 */
function attachWebsocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // single flat local VLAN, no cross-origin concerns
  });

  io.on('connection', (socket) => {
    socket.emit('config:update', configStore.get());

    socket.on('config:set', (partial) => {
      configStore.update(partial); // onChange below broadcasts the result
    });
  });

  configStore.onChange((config) => {
    io.emit('config:update', config);
  });

  return io;
}

module.exports = { attachWebsocket };
