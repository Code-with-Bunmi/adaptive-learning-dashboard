import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
dotenv.config();

import { connectRedis } from './config/redisClient.js';
import { requireAuth } from './middleware/auth.js';
import { actionLogger } from './middleware/actionLogger.js';
import { startNightlySync } from './jobs/nightlySync.js';

import authRoutes from './routes/authRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import evaluationRoutes from './routes/evaluationRoutes.js';

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Public (no session yet — this IS the login flow, plus the guarded dev-login).
app.use('/api/auth', authRoutes);

// Everything below requires a session; actionLogger records each call for §9 engagement metrics.
app.use('/api/student', requireAuth, actionLogger, studentRoutes);
app.use('/api/teacher', requireAuth, actionLogger, teacherRoutes);
app.use('/api/admin', requireAuth, actionLogger, adminRoutes);
app.use('/api/evaluation', requireAuth, actionLogger, evaluationRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 5000;

async function start() {
  await connectRedis();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✔ API running on port ${PORT}`);
    startNightlySync();
    if (process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN_ENABLED === 'true') {
      console.log('⚠ Dev-login bypass is ENABLED (NODE_ENV != production). Disable before deploying.');
    }
  });
}

start();
