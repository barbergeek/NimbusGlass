'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');

const { buildApiRouter } = require('./routes/api');
const { attachWebsocket } = require('./websocket');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const app = express();
app.use(express.json());

// Optional basic auth gate for the admin console UI. Unset ADMIN_USER/
// ADMIN_PASS to leave it open, which is reasonable on a trusted flat local
// VLAN. Note this only gates the /admin static page - it does not cover
// POST /api/config or the config:set socket event, so it's a UI convenience
// against casual access, not a hard permission boundary.
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  app.use('/admin', (req, res, next) => {
    const header = req.headers.authorization || '';
    const [, encoded] = header.split(' ');
    const decoded = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const [user, pass] = decoded.split(':');
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="NimbusGlass Admin"');
    res.status(401).send('Authentication required');
  });
}

app.use('/api', buildApiRouter());
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
app.use(express.static(PUBLIC_DIR));

const httpServer = http.createServer(app);
attachWebsocket(httpServer);

// Bind 0.0.0.0, not localhost: the mirror's Chromium kiosk and any phone/
// laptop on the same VLAN both need to reach this.
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`NimbusGlass listening on http://0.0.0.0:${PORT}`);
  console.log(`Admin console: http://<pi-ip>:${PORT}/admin`);
});
