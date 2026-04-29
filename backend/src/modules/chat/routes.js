import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/list', async(req, res) => {
  const members = await prisma.chatMember.findMany({
    where: {userId: req.user.id},
    include: {
      chat: {
        include: {
          members: {include: {user: {include: {profile: true}}}},
          messages: {orderBy: {createdAt: 'desc'}, take: 1}
        }
      }
    }
  });
  res.json(members.map((m) => m.chat));
});

router.get('/:id/messages', async(req, res) => {
  const messages = await prisma.message.findMany({
    where: {chatId: req.params.id},
    orderBy: {createdAt: 'asc'}
  });
  res.json(messages);
});

export default router;
