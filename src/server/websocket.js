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

  // Latest viewport reported by a mirror display page (not the admin
  // preview iframe), so the admin preview can match the real panel.
  let displayInfo = null;

  io.on('connection', (socket) => {
    socket.emit('config:update', configStore.get());
    if (displayInfo) socket.emit('display:info', displayInfo);

    socket.on('display:info', (info) => {
      // Only the kiosk on the Pi itself counts - a laptop browsing to the
      // mirror page shouldn't redefine "the display".
      const address = socket.handshake.address || '';
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return;
      const width = Math.round(Number(info && info.width));
      const height = Math.round(Number(info && info.height));
      if (!(width > 0 && height > 0)) return;
      displayInfo = { width, height, devicePixelRatio: Number(info.devicePixelRatio) || 1, reportedAt: Date.now() };
      io.emit('display:info', displayInfo);
    });

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
