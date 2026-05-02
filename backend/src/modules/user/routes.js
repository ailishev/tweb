import {Router} from 'express';
import prisma from '../../lib/prisma.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();

function buildProfileDefaults(user) {
  const p = user?.profile || {};
  const username = (typeof p.username === 'string' && p.username.trim()) ? p.username.trim() : null;
  return {
    firstName: p.firstName || null,
    lastName: p.lastName || null,
    username,
    usernames: Array.isArray(p.usernames) ? p.usernames : [],
    bio: p.bio || null,
    birthday: p.birthday || null,
    location: p.location || null,
    businessHours: p.businessHours || null,
    businessLocation: p.businessLocation || null,
    link: p.link || null,
    contactNote: p.contactNote || null,
    savedMusic: p.savedMusic || null,
    avatarUrl: p.avatarUrl || null,
    status: p.status || null,
    verified: typeof p.verified === 'boolean' ? p.verified : false,
    lastSeen: p.lastSeen || null,
    phoneNumber: p.phoneNumber || user.phone || null
  };
}

async function ensureProfileCompleteness(userId) {
  return prisma.user.findUnique({
    where: {id: userId},
    include: {profile: true, gifts: true}
  });
}

function toPlainProfile(user) {
  const p = user?.profile || {};
  const usernames = Array.isArray(p.usernames) ? p.usernames.filter((it) => typeof it === 'string' && it.trim()) : [];
  const username = (typeof p.username === 'string' && p.username.trim()) ? p.username.trim() : (usernames[0] || '');
  return {
    id: user.id,
    phone: user.phone || null,
    email: user.email || null,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    username,
    usernames: usernames.length ? usernames : (username ? [username] : []),
    bio: p.bio || '',
    birthday: p.birthday || null,
    location: p.location || null,
    businessHours: p.businessHours || null,
    businessLocation: p.businessLocation || null,
    link: p.link || '',
    contactNote: p.contactNote || '',
    savedMusic: p.savedMusic || null,
    avatar: p.avatarUrl || '',
    status: p.status || '',
    verified: !!(p.verified || p.isVerified),
    lastSeen: p.lastSeen || null,
    isPremium: !!p.isPremium,
    phoneNumber: p.phoneNumber || user.phone || null
  };
}

router.get('/me', authMiddleware, async(req, res) => {
  const user = await ensureProfileCompleteness(req.user.id);
  if(!user) {
    return res.status(404).json({error: 'Not found'});
  }
  const p = user.profile;
  const profile = toPlainProfile(user);
  res.json({
    ...user,
    profileData: profile,
    gifts: user.gifts || [],
    summary: {
      id: user.id,
      username: (p?.username && String(p.username).trim()) || '',
      avatar: p?.avatarUrl || '',
      status: p?.status || '',
      verified: !!p?.verified
    }
  });
});

/** Same as /me but always includes fresh profile (for UI bootstrap). */
router.get('/me/full', authMiddleware, async(req, res) => {
  const user = await ensureProfileCompleteness(req.user.id);
  if(!user) {
    return res.status(404).json({error: 'Not found'});
  }
  res.json({...user, profileData: toPlainProfile(user), gifts: user.gifts || []});
});

/** Profile bundle for Telegram UI (`users.getFullUser` adapter). */
router.get('/:id/full', authMiddleware, async(req, res) => {
  const user = await ensureProfileCompleteness(req.params.id);
  if(!user) return res.status(404).json({error: 'User not found'});
  res.json({...user, profileData: toPlainProfile(user), gifts: user.gifts || []});
});

router.get('/:id', authMiddleware, async(req, res) => {
  const user = await ensureProfileCompleteness(req.params.id);
  if(!user) return res.status(404).json({error: 'User not found'});
  res.json({...user, profileData: toPlainProfile(user), gifts: user.gifts || []});
});

export default router;
