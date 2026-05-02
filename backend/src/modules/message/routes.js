import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';
import {backendWsNotifyChatMembers} from '../../lib/wsBroadcast.js';

const router = Router();
router.use(authMiddleware);

router.post('/send', async(req, res) => {
  try {
    const {chatId, text} = req.body;
    if(!chatId || !text) return res.status(400).json({error: 'chatId and text are required'});

    const member = await prisma.chatMember.findUnique({
      where: {
        chatId_userId: {chatId, userId: req.user.id}
      }
    });
    if(!member) return res.status(403).json({error: 'Forbidden'});

    const message = await prisma.message.create({
      data: {
        chatId,
        senderId: req.user.id,
        text
      },
      include: {sender: {include: {profile: true}}}
    });

    await backendWsNotifyChatMembers(prisma, chatId, {
      type: 'new_message',
      chatId,
      message
    });

    await backendWsNotifyChatMembers(prisma, chatId, {
      type: 'message:new',
      chatId,
      message
    });

    res.json(message);
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'SEND_FAILED'});
  }
});

export default router;
