import express from 'express';
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/user/routes.js';
import chatRoutes from './modules/chat/routes.js';
import messageRoutes from './modules/message/routes.js';
import favoritesRoutes from './modules/favorites/routes.js';
import giftsRoutes from './modules/gifts/routes.js';

const app = express();
app.use(express.json());

const allowedOrigins = new Set([
  'http://localhost:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8081'
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if(origin && allowedOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if(req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.get('/health', (req, res) => res.json({ok: true}));
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/api/user', userRoutes);
app.use('/chats', chatRoutes);
app.use('/api/chats', chatRoutes);
app.use('/messages', messageRoutes);
app.use('/api/messages', messageRoutes);
app.use('/favorites', favoritesRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/gifts', giftsRoutes);
app.use('/api/gifts', giftsRoutes);

export default app;
