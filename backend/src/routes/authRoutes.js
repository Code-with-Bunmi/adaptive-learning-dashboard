import express from 'express';
import { googleLogin, logout, devLogin, me } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { devLoginGuard } from '../middleware/devLoginGuard.js';

const router = express.Router();

router.post('/google', googleLogin);
router.post('/logout', logout);
router.post('/dev-login', devLoginGuard, devLogin);
router.get('/me', requireAuth, me);

export default router;
