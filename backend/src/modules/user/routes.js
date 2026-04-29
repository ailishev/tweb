import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();

router.get('/me', authMiddleware, async(req, res) => {
  res.json(req.user);
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
