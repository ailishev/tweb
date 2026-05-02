import {ensureSavedMessagesChat} from './savedMessagesChat.js';
import {backendWsNotifyChatMembers} from './wsBroadcast.js';

async function assertMember(prisma, chatId, userId) {
  const m = await prisma.chatMember.findUnique({
    where: {chatId_userId: {chatId, userId}}
  });
  if(!m) {
    const err = new Error('NOT_MEMBER');
    err.code = 'NOT_MEMBER';
    throw err;
  }
  return m;
}

async function unreadCountFor(prisma, chatId, userId, lastReadAt) {
  const ref = lastReadAt || new Date(0);
  return prisma.message.count({
    where: {
      chatId,
      createdAt: {gt: ref},
      NOT: {senderId: userId}
    }
  });
}

async function buildChatListPayload(prisma, userId, payload) {
  await ensureSavedMessagesChat(prisma, userId);

  const limit = Math.min(Math.max(parseInt(payload?.limit, 10) || 30, 1), 100);
  const cursor = payload?.cursor ? String(payload.cursor) : null;

  const members = await prisma.chatMember.findMany({
    where: {userId},
    include: {
      chat: {
        include: {
          members: {include: {user: {include: {profile: true}}}},
          messages: {orderBy: {createdAt: 'desc'}, take: 1},
          readStates: {
            where: {userId}
          }
        }
      }
    }
  });

  const rows = members.map((m) => {
    const chat = m.chat;
    const last = chat.messages[0];
    const read = chat.readStates[0];
    const sortKey = last?.createdAt?.getTime?.() || chat.createdAt.getTime();
    return {chat, last, read, sortKey};
  });

  rows.sort((a, b) => b.sortKey - a.sortKey);

  let start = 0;
  if(cursor) {
    const idx = rows.findIndex((r) => r.chat.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }

  const slice = rows.slice(start, start + limit);
  const items = [];

  for(const {chat, last, read} of slice) {
    const uc = await unreadCountFor(prisma, chat.id, userId, read?.lastReadAt);
    items.push({
      ...chat,
      members: chat.members,
      messages: undefined,
      readStates: undefined,
      lastMessage: last || null,
      unreadCount: uc,
      updatedAt: last?.createdAt || chat.createdAt
    });
  }

  const nextCursor = slice.length === limit ? slice[slice.length - 1].chat.id : null;
  return {items, nextCursor, hasMore: !!nextCursor};
}

async function handleGetMessages(prisma, userId, payload) {
  const chatId = payload?.chatId;
  if(!chatId) {
    throw Object.assign(new Error('chatId required'), {code: 'BAD_REQUEST'});
  }

  await assertMember(prisma, chatId, userId);

  const limit = Math.min(Math.max(parseInt(payload?.limit, 10) || 50, 1), 100);
  const before = payload?.before ? new Date(payload.before) : null;

  const messages = await prisma.message.findMany({
    where: {
      chatId,
      ...(before ? {createdAt: {lt: before}} : {})
    },
    orderBy: {createdAt: 'desc'},
    take: limit,
    include: {sender: {include: {profile: true}}}
  });

  messages.reverse();
  return {messages, hasMore: messages.length === limit};
}

async function handleSendMessage(prisma, userId, payload) {
  const {chatId, text} = payload || {};
  if(!chatId || !text) {
    throw Object.assign(new Error('chatId and text required'), {code: 'BAD_REQUEST'});
  }

  await assertMember(prisma, chatId, userId);

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: userId,
      text: String(text)
    },
    include: {sender: {include: {profile: true}}}
  });

  const pushPayload = {
    type: 'new_message',
    chatId,
    message
  };

  await backendWsNotifyChatMembers(prisma, chatId, pushPayload);
  await backendWsNotifyChatMembers(prisma, chatId, {
    type: 'message:new',
    chatId,
    message
  });

  return message;
}

async function handleGetCurrentUser(prisma, userId) {
  const user = await prisma.user.findUnique({
    where: {id: userId},
    include: {profile: true}
  });
  if(!user) {
    throw Object.assign(new Error('USER_NOT_FOUND'), {code: 'USER_NOT_FOUND'});
  }
  const p = user.profile;
  const usernames = Array.isArray(p?.usernames) ? p.usernames.filter((it) => typeof it === 'string' && it.trim()) : [];
  const username = (p?.username && String(p.username).trim()) || usernames[0] || '';
  return {
    id: user.id,
    phone: user.phone || null,
    email: user.email || null,
    firstName: p?.firstName || '',
    lastName: p?.lastName || '',
    username,
    usernames: usernames.length ? usernames : (username ? [username] : []),
    bio: p?.bio || '',
    birthday: p?.birthday || null,
    location: p?.location || null,
    businessHours: p?.businessHours || null,
    businessLocation: p?.businessLocation || null,
    link: p?.link || '',
    contactNote: p?.contactNote || '',
    savedMusic: p?.savedMusic || null,
    isPremium: !!p?.isPremium,
    avatar: p?.avatarUrl || '',
    status: p?.status || '',
    verified: !!(p?.verified || p?.isVerified),
    lastSeen: p?.lastSeen || null,
    phoneNumber: p?.phoneNumber || user.phone || null
  };
}

async function handleGetChatsStrict(prisma, userId) {
  const pack = await buildChatListPayload(prisma, userId, {});
  return pack.items.map((item) => ({
    id: item.id,
    title: item.title || 'Chat',
    type: item.type === 'saved' ? 'private' : item.type === 'channel' ? 'group' : item.type,
    lastMessage: item.lastMessage ? {
      text: item.lastMessage.text || '',
      createdAt: (() => {
        const d = item.lastMessage.createdAt;
        if(d instanceof Date) return d.getTime();
        const t = new Date(d).getTime();
        return Number.isFinite(t) ? t : Date.now();
      })(),
      senderId: item.lastMessage.senderId
    } : undefined
  }));
}

/**
 * @param {import('../lib/prisma.js').default} prisma
 * @param {string} userId
 * @param {unknown} rawMsg
 * @param {import('ws').WebSocket} ws
 */
export async function handleWsRpc(prisma, userId, rawMsg, ws) {
  if(!rawMsg || typeof rawMsg !== 'object') {
    return;
  }

  const msg = rawMsg;
  const reqId = typeof msg.reqId === 'string' ? msg.reqId : null;
  const type = typeof msg.type === 'string' ? msg.type : null;

  const reply = (ok, data, error) => {
    if(!reqId) {
      return;
    }
    if(ok) {
      ws.send(JSON.stringify({reqId, ok: true, data}));
    } else {
      ws.send(JSON.stringify({reqId, ok: false, error: error || 'REQUEST_FAILED'}));
    }
  };

  if(!reqId || !type) {
    return;
  }

  try {
    let data;
    switch(type) {
      case 'getCurrentUser':
        data = await handleGetCurrentUser(prisma, userId);
        break;
      case 'getChats':
        data = await handleGetChatsStrict(prisma, userId);
        break;
      case 'listChats':
        data = await buildChatListPayload(prisma, userId, msg.payload);
        break;
      case 'getMessages':
        data = await handleGetMessages(prisma, userId, msg.payload);
        break;
      case 'sendMessage':
        data = await handleSendMessage(prisma, userId, msg.payload);
        break;
      default:
        reply(false, undefined, 'UNKNOWN_METHOD');
        return;
    }
    reply(true, data, undefined);
  } catch(err) {
    console.error('wsRpc', type, err);
    reply(false, undefined, err.code || err.message || 'ERROR');
  }
}
