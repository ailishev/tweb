import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';
import {backendWsNotifyChatMembers, backendWsNotifyUser} from '../../lib/wsBroadcast.js';
import {ensureSavedMessagesChat} from '../../lib/savedMessagesChat.js';

const router = Router();
router.use(authMiddleware);

async function assertMember(chatId, userId) {
  const m = await prisma.chatMember.findUnique({
    where: {
      chatId_userId: {chatId, userId}
    }
  });
  if(!m) {
    const err = new Error('NOT_MEMBER');
    err.status = 403;
    throw err;
  }
  return m;
}

async function unreadCountFor(chatId, userId, lastReadAt) {
  const ref = lastReadAt || new Date(0);
  return prisma.message.count({
    where: {
      chatId,
      createdAt: {gt: ref},
      NOT: {senderId: userId}
    }
  });
}

/** POST /chats/create — group/channel bootstrap (optional memberIds). */
router.post('/create', async(req, res) => {
  try {
    const {type, title, memberIds} = req.body || {};
    const t = type === 'private' || type === 'group' || type === 'channel' ? type : 'group';
    const ids = new Set([...(Array.isArray(memberIds) ? memberIds : []), req.user.id]);

    const chat = await prisma.chat.create({
      data: {
        type: t,
        title: title || (t === 'group' ? 'Group' : 'Chat'),
        members: {
          create: [...ids].map((userId) => ({
            userId,
            role: userId === req.user.id ? 'owner' : 'member'
          }))
        }
      },
      include: {
        members: {include: {user: {include: {profile: true}}}}
      }
    });

    for(const uid of ids) {
      backendWsNotifyUser(uid, {type: 'chat_created', chat});
    }

    res.json(chat);
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'CREATE_CHAT_FAILED'});
  }
});

/** GET /chats/list?cursor=&limit= */
router.get('/list', async(req, res) => {
  try {
    await ensureSavedMessagesChat(prisma, req.user.id);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const members = await prisma.chatMember.findMany({
      where: {userId: req.user.id},
      include: {
        chat: {
          include: {
            members: {include: {user: {include: {profile: true}}}},
            messages: {orderBy: {createdAt: 'desc'}, take: 1},
            readStates: {
              where: {userId: req.user.id}
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
      const uc = await unreadCountFor(chat.id, req.user.id, read?.lastReadAt);
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

    res.json({items, nextCursor, hasMore: !!nextCursor});
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'LIST_FAILED'});
  }
});

/** GET /chats/:id/messages?before=&limit= */
router.get('/:id/messages', async(req, res) => {
  try {
    const chatId = req.params.id;
    await assertMember(chatId, req.user.id);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const before = req.query.before ? new Date(req.query.before) : null;

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
    res.json({messages, hasMore: messages.length === limit});
  } catch(err) {
    if(err.status === 403) return res.status(403).json({error: 'Forbidden'});
    console.error(err);
    res.status(500).json({error: 'MESSAGES_FAILED'});
  }
});

/** POST /chats/:id/read */
router.post('/:id/read', async(req, res) => {
  try {
    const chatId = req.params.id;
    await assertMember(chatId, req.user.id);

    const latest = await prisma.message.findFirst({
      where: {chatId},
      orderBy: {createdAt: 'desc'}
    });

    const at = latest?.createdAt || new Date();

    await prisma.chatReadState.upsert({
      where: {
        chatId_userId: {chatId, userId: req.user.id}
      },
      create: {
        chatId,
        userId: req.user.id,
        lastReadAt: at
      },
      update: {
        lastReadAt: at
      }
    });

    await backendWsNotifyChatMembers(prisma, chatId, {
      type: 'read:updated',
      chatId,
      userId: req.user.id,
      lastReadAt: at.toISOString()
    });

    res.json({ok: true});
  } catch(err) {
    if(err.status === 403) return res.status(403).json({error: 'Forbidden'});
    console.error(err);
    res.status(500).json({error: 'READ_FAILED'});
  }
});

/** GET /chats/:id/full */
router.get('/:id/full', async(req, res) => {
  try {
    const chatId = req.params.id;
    await assertMember(chatId, req.user.id);

    const chat = await prisma.chat.findUnique({
      where: {id: chatId},
      include: {
        members: {include: {user: {include: {profile: true}}}},
        messages: {orderBy: {createdAt: 'desc'}, take: 1}
      }
    });

    if(!chat) return res.status(404).json({error: 'Not found'});
    res.json(chat);
  } catch(err) {
    if(err.status === 403) return res.status(403).json({error: 'Forbidden'});
    console.error(err);
    res.status(500).json({error: 'FULL_FAILED'});
  }
});

export default router;
