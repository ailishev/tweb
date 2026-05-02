import {Router} from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../../lib/prisma.js';
import {env} from '../../config/env.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();

function defaultProfileData({phone, firstName, lastName}) {
  const digits = String(phone || '').replace(/\D/g, '');
  const suffix = digits ? digits.slice(-10) : String(Date.now()).slice(-10);
  const username = `user${suffix}`;
  return {
    firstName,
    lastName,
    username,
    usernames: [username],
    bio: 'About me',
    birthday: new Date('1999-01-01T00:00:00.000Z'),
    location: {address: 'Kyiv'},
    businessHours: {
      timezone_id: 'Europe/Kyiv',
      weekly_open: [{start_minute: 540, end_minute: 1080}]
    },
    businessLocation: {address: 'Kyiv'},
    link: `t.me/${username}`,
    contactNote: 'Personal note',
    savedMusic: {title: 'Saved Track', performer: 'Unknown Artist'},
    status: 'online',
    verified: false,
    lastSeen: new Date(),
    phoneNumber: phone
  };
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/request-otp', async(req, res) => {
  const {phone} = req.body;
  if(!phone) return res.status(400).json({error: 'phone is required'});

  const code = generateOtp();
  // NOTE: OTP stored in DB as plain digits (dev-only approach).
  const codeHash = code;

  await prisma.phoneOtp.create({
    data: {
      phone,
      codeHash,
      expiresAt: new Date(Date.now() + env.otpTtlMs)
    }
  });

  // Dev-friendly OTP output: plain code in backend logs, hashed in DB.
  console.log(`[OTP] phone=${phone} code=${code}`);

  res.json({ok: true, otpSent: true});
});

router.post('/verify-otp', async(req, res) => {
  const {phone, code} = req.body;
  const otp = await prisma.phoneOtp.findFirst({where: {phone}, orderBy: {createdAt: 'desc'}});
  if(!otp) return res.status(400).json({error: 'OTP not found'});
  if(otp.expiresAt < new Date()) return res.status(400).json({error: 'OTP expired'});
  if(otp.attempts >= 5) return res.status(400).json({error: 'Too many attempts'});

  const valid = code === otp.codeHash;
  if(!valid) {
    await prisma.phoneOtp.update({where: {id: otp.id}, data: {attempts: {increment: 1}}});
    return res.status(400).json({error: 'Invalid OTP'});
  }

  const existingUser = await prisma.user.findUnique({
    where: {phone},
    include: {profile: true}
  });

  if(!existingUser?.profile?.firstName) {
    return res.json({ok: true, requires_signup: true});
  }

  const token = crypto.randomBytes(32).toString('hex');
  const session = await prisma.session.create({
    data: {userId: existingUser.id, token, expiresAt: new Date(Date.now() + env.sessionTtlMs)}
  });

  res.json({token: session.token, user: existingUser});
});

router.post('/complete-profile', async(req, res) => {
  const {phone, code, firstName, lastName} = req.body;
  if(!phone || !code) return res.status(400).json({error: 'phone and code are required'});
  if(!firstName) return res.status(400).json({error: 'firstName is required'});

  const otp = await prisma.phoneOtp.findFirst({where: {phone}, orderBy: {createdAt: 'desc'}});
  if(!otp) return res.status(400).json({error: 'OTP not found'});
  if(otp.expiresAt < new Date()) return res.status(400).json({error: 'OTP expired'});
  if(otp.attempts >= 5) return res.status(400).json({error: 'Too many attempts'});

  const valid = code === otp.codeHash;
  if(!valid) {
    await prisma.phoneOtp.update({where: {id: otp.id}, data: {attempts: {increment: 1}}});
    return res.status(400).json({error: 'Invalid OTP'});
  }

  const user = await prisma.user.upsert({
    where: {phone},
    update: {
      profile: {
        upsert: {
          create: defaultProfileData({phone, firstName, lastName}),
          update: {firstName, lastName}
        }
      }
    },
    create: {
      phone,
      profile: {create: defaultProfileData({phone, firstName, lastName})}
    },
    include: {profile: true}
  });

  const token = crypto.randomBytes(32).toString('hex');
  const session = await prisma.session.create({
    data: {userId: user.id, token, expiresAt: new Date(Date.now() + env.sessionTtlMs)}
  });

  res.json({token: session.token, user});
});

router.post('/register', async(req, res) => {
  const {email, phone, password, firstName, lastName} = req.body;
  if(!password || (!email && !phone)) {
    return res.status(400).json({error: 'password and (email or phone) are required'});
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      phone: phone || `user_${Date.now()}`,
      passwordHash,
      profile: {
        create: {
          ...defaultProfileData({phone, firstName, lastName})
        }
      }
    },
    include: {profile: true}
  });

  const token = crypto.randomBytes(32).toString('hex');
  const session = await prisma.session.create({
    data: {userId: user.id, token, expiresAt: new Date(Date.now() + env.sessionTtlMs)}
  });

  res.json({token: session.token, user});
});

router.post('/login', async(req, res) => {
  const {email, phone, password} = req.body;
  if(!password || (!email && !phone)) {
    return res.status(400).json({error: 'password and (email or phone) are required'});
  }

  const user = await prisma.user.findFirst({
    where: email ? {email} : {phone},
    include: {profile: true}
  });

  if(!user?.passwordHash) {
    return res.status(400).json({error: 'Invalid credentials'});
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if(!valid) {
    return res.status(400).json({error: 'Invalid credentials'});
  }

  const token = crypto.randomBytes(32).toString('hex');
  const session = await prisma.session.create({
    data: {userId: user.id, token, expiresAt: new Date(Date.now() + env.sessionTtlMs)}
  });

  res.json({token: session.token, user});
});

router.post('/logout', authMiddleware, async(req, res) => {
  await prisma.session.delete({where: {id: req.session.id}});
  res.json({ok: true});
});

router.get('/session', authMiddleware, async(req, res) => {
  res.json({valid: true, user: req.user});
});

export default router;
