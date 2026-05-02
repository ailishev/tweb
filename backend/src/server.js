import {env} from './config/env.js';
import http from 'http';
import app from './app.js';
import prisma from './lib/prisma.js';
import {attachWebSocketHub} from './lib/wsHub.js';

const server = http.createServer(app);

attachWebSocketHub(server, prisma);

server.listen(env.port, () => {
  console.log(`Messenger backend listening on :${env.port}`);
});
