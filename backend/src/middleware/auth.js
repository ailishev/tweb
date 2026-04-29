import prisma from '../lib/prisma.js';

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) {
    return res.status(401).json({error: 'Unauthorized'});
  }

  const session = await prisma.session.findUnique({
    where: {token},
    include: {user: {include: {profile: true}}}
  });

  if(!session || session.expiresAt < new Date()) {
    return res.status(401).json({error: 'Session expired'});
  }

  req.session = session;
  req.user = session.user;
  next();
}
