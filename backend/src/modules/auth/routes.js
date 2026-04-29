import {Router} from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../../lib/prisma.js';
import {env} from '../../config/env.js';
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/request-otp', async(req, res) => {
  const {phone} = req.body;
  if(!phone) return res.status(400).json({error: 'phone is required'});

  const code = generateOtp();
  const codeHash = await bcrypt.hash(code, 10);

  await prisma.phoneOtp.create({
    data: {
      phone,
      codeHash,
      expiresAt: new Date(Date.now() + env.otpTtlMs)
    }
  });

  res.json({ok: true, otpSent: true, debugCode: code});
});

router.post('/verify-otp', async(req, res) => {
  const {phone, code} = req.body;
  const otp = await prisma.phoneOtp.findFirst({where: {phone}, orderBy: {createdAt: 'desc'}});
  if(!otp) return res.status(400).json({error: 'OTP not found'});
  if(otp.expiresAt < new Date()) return res.status(400).json({error: 'OTP expired'});
  if(otp.attempts >= 5) return res.status(400).json({error: 'Too many attempts'});

  const valid = await bcrypt.compare(code, otp.codeHash);
  if(!valid) {
    await prisma.phoneOtp.update({where: {id: otp.id}, data: {attempts: {increment: 1}}});
    return res.status(400).json({error: 'Invalid OTP'});
  }

  const user = await prisma.user.upsert({
    where: {phone},
    update: {},
    create: {phone, profile: {create: {phoneNumber: phone}}},
    include: {profile: true}
  });

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
