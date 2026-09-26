import express from 'express';
import {
  getOverview,
  getCourses,
  getScoringConfig,
  putScoringConfig,
  triggerSync,
  getSyncLogs,
  getEvaluationSummary,
} from '../controllers/adminController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/overview', getOverview);
router.get('/courses', getCourses);
router.get('/scoring-config', getScoringConfig);
router.put('/scoring-config', putScoringConfig);
router.post('/sync', triggerSync);
router.get('/sync-logs', getSyncLogs);
router.get('/evaluation/summary', getEvaluationSummary);

export default router;
