import express from 'express';
import { submitSus, submitFeedback } from '../controllers/evaluationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth); // any signed-in role (student, teacher, or admin) can submit

router.post('/sus', submitSus);
router.post('/feedback', submitFeedback);

export default router;
