import express from 'express';
import { getCourses, getDashboard, getTrends } from '../controllers/studentController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/dashboard', getDashboard);
router.get('/courses', getCourses);
router.get('/trends', getTrends);

export default router;
