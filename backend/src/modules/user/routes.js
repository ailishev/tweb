import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();

router.get('/me', authMiddleware, async(req, res) => {
  const user = await prisma.user.findUnique({
    where: {id: req.user.id},
    include: {profile: true}
  });
  if(!user) {
    return res.status(404).json({error: 'Not found'});
  }
  const p = user.profile;
  res.json({
    ...user,
    summary: {
      id: user.id,
      username: (p?.username && String(p.username).trim()) || '',
      avatar: p?.avatarUrl || '',
      status: p?.status || ''
    }
  });
});

/** Same as /me but always includes fresh profile (for UI bootstrap). */
router.get('/me/full', authMiddleware, async(req, res) => {
  const user = await prisma.user.findUnique({
    where: {id: req.user.id},
    include: {profile: true}
  });
  res.json(user);
});

/** Profile bundle for Telegram UI (`users.getFullUser` adapter). */
router.get('/:id/full', authMiddleware, async(req, res) => {
  const user = await prisma.user.findUnique({
    where: {id: req.params.id},
    include: {profile: true}
  });
  if(!user) return res.status(404).json({error: 'User not found'});
  res.json(user);
});

router.get('/:id', authMiddleware, async(req, res) => {
  const user = await prisma.user.findUnique({
    where: {id: req.params.id},
    include: {profile: true}
  });
  if(!user) return res.status(404).json({error: 'User not found'});
  res.json(user);
});

export default router;
