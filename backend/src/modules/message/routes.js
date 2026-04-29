import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.post('/send', async(req, res) => {
  const {chatId, text} = req.body;
  if(!chatId || !text) return res.status(400).json({error: 'chatId and text are required'});

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: req.user.id,
      text
    }
  });

  res.json(message);
});

export default router;
