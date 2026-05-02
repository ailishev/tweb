/** @type {Map<string, Set<import('ws').WebSocket>>} */
const socketsByUserId = new Map();

/**
 * Track an open socket for a user (dedupe close handler).
 * @param {string} userId
 * @param {import('ws').WebSocket} ws
 */
export function trackWsConnection(userId, ws) {
  let set = socketsByUserId.get(userId);
  if(!set) {
    set = new Set();
    socketsByUserId.set(userId, set);
  }
  set.add(ws);

  ws.on('close', () => {
    set.delete(ws);
    if(set.size === 0) {
      socketsByUserId.delete(userId);
    }
  });
}

export function backendWsNotifyUser(userId, payload) {
  const set = socketsByUserId.get(userId);
  if(!set?.size) return;
  const raw = JSON.stringify(payload);
  for(const ws of set) {
    if(ws.readyState === 1) {
      ws.send(raw);
    }
  }
}

export async function backendWsNotifyChatMembers(prisma, chatId, payload, options = {}) {
  const {exceptUserId} = options;
  const members = await prisma.chatMember.findMany({
    where: {chatId},
    select: {userId: true}
  });
  for(const {userId} of members) {
    if(exceptUserId && userId === exceptUserId) {
      continue;
    }
    backendWsNotifyUser(userId, payload);
  }
}
