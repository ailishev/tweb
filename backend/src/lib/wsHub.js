import {WebSocketServer} from 'ws';
import {handleWsRpc} from './wsRpc.js';
import {trackWsConnection} from './wsBroadcast.js';

/**
 * @param {import('http').Server} server
 * @param {import('../lib/prisma.js').default} prisma
 */
export function attachWebSocketHub(server, prisma) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, cb) => {
      (async() => {
        try {
          const url = new URL(info.req.url || '/', 'http://localhost');
          const token = url.searchParams.get('token');
          if(!token) {
            cb(false, 401, 'Unauthorized');
            return;
          }

          const session = await prisma.session.findUnique({
            where: {token},
            include: {user: true}
          });

          if(!session || session.expiresAt < new Date()) {
            cb(false, 401, 'Unauthorized');
            return;
          }

          info.req.backendUserId = session.userId;
          cb(true);
        } catch(err) {
          console.error('WS verifyClient', err);
          cb(false, 500, 'Error');
        }
      })();
    }
  });

  wss.on('connection', (ws, req) => {
    const userId = req.backendUserId;
    if(!userId) {
      ws.close();
      return;
    }

    trackWsConnection(userId, ws);

    ws.on('message', (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch(err) {
        return;
      }

      if(parsed && typeof parsed === 'object' && parsed.type === 'ping') {
        ws.send(JSON.stringify({type: 'pong', t: Date.now()}));
        return;
      }

      handleWsRpc(prisma, userId, parsed, ws);
    });
  });

  return wss;
}
