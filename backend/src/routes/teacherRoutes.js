import express from 'express';
import {
  getCourses,
  getCourseStudents,
  getAtRiskStudents,
  getCourseTrends,
  getStudentDetail,
  recalculateCourse,
  getCourseScoringConfig,
  updateCourseScoringConfig,
} from '../controllers/teacherController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();
router.use(requireAuth, requireRole('teacher', 'admin'));

router.get('/courses', getCourses);
router.get('/course/:id/students', getCourseStudents);
router.get('/course/:id/at-risk', getAtRiskStudents);
router.get('/course/:id/trends', getCourseTrends);
router.get('/course/:id/student/:studentId', getStudentDetail);
router.post('/course/:id/recalculate', recalculateCourse);
router.get('/course/:id/scoring-config', getCourseScoringConfig);
router.put('/course/:id/scoring-config', updateCourseScoringConfig);

export default router;
