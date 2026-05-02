import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';
import {backendWsNotifyUser} from '../../lib/wsBroadcast.js';

const router = Router();
router.use(authMiddleware);

/** GET /gifts/mine */
router.get('/mine', async(req, res) => {
  try {
    const items = await prisma.gift.findMany({
      where: {ownerId: req.user.id},
      orderBy: {createdAt: 'desc'}
    });
    res.json({items});
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'GIFTS_FAILED'});
  }
});

/**
 * POST /gifts/receive — demo hook: attach gift to user and push realtime (replace with real commerce later).
 */
router.post('/receive', async(req, res) => {
  try {
    const {rarity, animation, title} = req.body || {};
    const gift = await prisma.gift.create({
      data: {
        ownerId: req.user.id,
        rarity: rarity ? String(rarity) : 'standard',
        animation: animation ? String(animation) : null,
        title: title ? String(title) : null
      }
    });

    backendWsNotifyUser(req.user.id, {
      type: 'gift_received',
      gift,
      ownerId: req.user.id
    });

    res.json(gift);
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'GIFT_RECEIVE_FAILED'});
  }
});

export default router;
