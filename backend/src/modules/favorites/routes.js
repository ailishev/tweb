import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

async function assertMember(chatId, userId) {
  const m = await prisma.chatMember.findUnique({
    where: {chatId_userId: {chatId, userId}}
  });
  if(!m) {
    const err = new Error('NOT_MEMBER');
    err.status = 403;
    throw err;
  }
}

/** POST /favorites { messageId } — Saved Messages / starred reference in DB. */
router.post('/', async(req, res) => {
  try {
    const messageId = req.body?.messageId;
    if(!messageId) {
      return res.status(400).json({error: 'messageId required'});
    }

    const msg = await prisma.message.findUnique({where: {id: messageId}});
    if(!msg) {
      return res.status(404).json({error: 'NOT_FOUND'});
    }

    await assertMember(msg.chatId, req.user.id);

    await prisma.favorite.upsert({
      where: {
        userId_messageId: {userId: req.user.id, messageId}
      },
      create: {
        userId: req.user.id,
        messageId,
        chatId: msg.chatId
      },
      update: {}
    });

    res.json({ok: true});
  } catch(err) {
    if(err.status === 403) {
      return res.status(403).json({error: 'Forbidden'});
    }
    console.error(err);
    res.status(500).json({error: 'FAVORITE_FAILED'});
  }
});

/** DELETE /favorites/:messageId */
router.delete('/:messageId', async(req, res) => {
  try {
    await prisma.favorite.deleteMany({
      where: {userId: req.user.id, messageId: req.params.messageId}
    });
    res.json({ok: true});
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'UNFAVORITE_FAILED'});
  }
});

/** GET /favorites */
router.get('/', async(req, res) => {
  try {
    const rows = await prisma.favorite.findMany({
      where: {userId: req.user.id},
      include: {
        message: {include: {sender: {include: {profile: true}}}},
        chat: true
      },
      orderBy: {createdAt: 'desc'}
    });
    res.json({items: rows});
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'LIST_FAILED'});
  }
});

export default router;
