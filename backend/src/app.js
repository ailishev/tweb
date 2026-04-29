import express from 'express';
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/user/routes.js';
import chatRoutes from './modules/chat/routes.js';
import messageRoutes from './modules/message/routes.js';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ok: true}));
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/chats', chatRoutes);
app.use('/messages', messageRoutes);

export default app;
