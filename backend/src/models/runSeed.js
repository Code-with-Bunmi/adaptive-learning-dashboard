/**
 * Seed script (§11.5): creates the sample student Olubunmi plus a few classmates, courses,
 * coursework, and submissions — entirely local data, no live Google Classroom connection
 * required. Pairs with the dev-login bypass (backend/src/middleware/devLoginGuard.js) so every
 * dashboard is explorable end-to-end without a real Google Workspace account.
 *
 * These seeded users have NO google_id_hash (NULL) — they only exist for local dev-login.
 * A real account gets its google_id_hash set the first time it signs in with Google for real.
 *
 * Usage: npm run seed
 */
import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import pool from '../config/db.js';
import { connectRedis, redisClient } from '../config/redisClient.js';
import { recomputeForCourse } from '../services/scoringService.js';

/** Dev-seeded users have no real Google "sub" to hash, so we hash a synthetic, stable
 *  identifier instead — keeps the same NOT NULL/UNIQUE invariant every real Google login
 *  relies on, without weakening the schema just to accommodate seed data. */
function placeholderGoogleIdHash(email) {
  return crypto.createHash('sha256').update(`dev-seed:${email}`).digest('hex');
}

async function insertUser(client, { name, email, role }) {
  const { rows } = await client.query(
    `INSERT INTO users (name, email, role, google_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name = $1, role = $3
     RETURNING id`,
    [name, email, role, placeholderGoogleIdHash(email)]
  );
  return rows[0].id;
}

async function run() {
  const client = await pool.connect();
  await connectRedis(); // scoringService invalidates cache keys on every recompute — needs a live connection
  try {
    // Idempotency: seeded courses always have classroom_course_id IS NULL (a real Classroom
    // sync always sets it), so re-running `npm run seed` cleanly replaces prior demo data via
    // cascade (enrollments/assignments/submissions/risk_scores/ai_feedback all ON DELETE
    // CASCADE from courses) without ever touching real synced courses.
    console.log('→ Clearing any previous seed data...');
    await client.query('DELETE FROM courses WHERE classroom_course_id IS NULL');
    console.log('→ Seeding users (Part 5, OAU Faculty of CSE)...');

    const teacherId = await insertUser(client, {
      name: 'Dr. Adewale Fashina',
      email: 'teacher@demo.oau.edu.ng',
      role: 'teacher',
    });
    const adminId = await insertUser(client, {
      name: 'Mrs. Bisi Adeyemi',
      email: 'admin@demo.oau.edu.ng',
      role: 'admin',
    });

    // Sample student used throughout Chapter 3 as the running example.
    const olubunmiId = await insertUser(client, {
      name: 'Olubunmi Olowookere',
      email: 'olowookere.bunmi001@gmail.com',
      role: 'student',
    });

    const classmates = [
      ['Chinedu Okonkwo', 'chinedu.okonkwo@demo.oau.edu.ng'],
      ['Amina Suleiman', 'amina.suleiman@demo.oau.edu.ng'],
      ['Tolu Adebayo', 'tolu.adebayo@demo.oau.edu.ng'],
      ['Grace Effiong', 'grace.effiong@demo.oau.edu.ng'],
      ['Segun Okafor', 'segun.okafor@demo.oau.edu.ng'],
    ];
    const classmateIds = [];
    for (const [name, email] of classmates) {
      classmateIds.push(await insertUser(client, { name, email, role: 'student' }));
    }
    const allStudentIds = [olubunmiId, ...classmateIds];

    console.log('→ Seeding courses (Part 5 CSE courses)...');
    const courseDefs = [
      ['Object Oriented Model', 'CSC 505'],
      ['Digital Computer Networks', 'CSC 517'],
      ['hardware Systems', 'CSC 502'],
    ];
    const courseIds = [];
    for (const [name, section] of courseDefs) {
      const { rows } = await client.query(
        `INSERT INTO courses (name, section, teacher_id, synced_at) VALUES ($1,$2,$3, NOW())
         RETURNING id`,
        [name, section, teacherId]
      );
      courseIds.push(rows[0].id);
    }

    console.log('→ Enrolling teacher + students...');
    for (const courseId of courseIds) {
      await client.query(
        `INSERT INTO enrollments (user_id, course_id, role) VALUES ($1,$2,'teacher')
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [teacherId, courseId]
      );
      for (const sId of allStudentIds) {
        await client.query(
          `INSERT INTO enrollments (user_id, course_id, role) VALUES ($1,$2,'student')
           ON CONFLICT (user_id, course_id) DO NOTHING`,
          [sId, courseId]
        );
      }
    }

    console.log('→ Creating coursework + submissions...');
    const assignmentTitles = [
      'Assignment 1: Requirements Analysis',
      'Assignment 2: UML Design',
      'Midterm Test',
      'Assignment 3: Implementation',
      'Assignment 4: Testing & QA',
      'Final Project',
    ];

    // Olubunmi is the running example used throughout Chapter 3, so her profile is FIXED
    // (not random) — every `npm run seed` reproduces the exact same demo: one course lands
    // her "at_risk", one "watch", one "safe", so every level of the dashboard is reliably
    // demonstrable. Indexed by assignment position (0-5). onTime only matters for TURNED_IN.
    const OLUBUNMI_PATTERNS = [
      // Course 1 (Software Engineering) -> at_risk: mostly missing, the little that's turned
      // in comes in late with weak grades. (score = 0.5*grade + 0.35*submission + 0.15*participation)
      [
        { state: 'MISSING' },
        { state: 'MISSING' },
        { state: 'MISSING' },
        { state: 'LATE', grade: 30 },
        { state: 'MISSING' },
        { state: 'LATE', grade: 35 },
      ],
      // Course 2 (Database Systems) -> watch: mixed — some missing, grades middling.
      [
        { state: 'MISSING' },
        { state: 'TURNED_IN', grade: 55 },
        { state: 'LATE', grade: 60 },
        { state: 'TURNED_IN', grade: 65 },
        { state: 'MISSING' },
        { state: 'TURNED_IN', grade: 70 },
      ],
      // Course 3 (Artificial Intelligence) -> safe: consistent, mostly on-time, strong grades.
      [
        { state: 'MISSING' },
        { state: 'TURNED_IN', grade: 85 },
        { state: 'TURNED_IN', grade: 90 },
        { state: 'LATE', grade: 75 },
        { state: 'TURNED_IN', grade: 95 },
        { state: 'TURNED_IN', grade: 88 },
      ],
    ];

    for (let ci = 0; ci < courseIds.length; ci++) {
      const courseId = courseIds[ci];
      for (let ai = 0; ai < assignmentTitles.length; ai++) {
        const title = assignmentTitles[ai];
        const { rows } = await client.query(
          `INSERT INTO assignments (course_id, title, due_date, max_points)
           VALUES ($1, $2, NOW() - (floor(random()*20) || ' days')::interval, 100)
           RETURNING id, due_date`,
          [courseId, title]
        );
        const assignment = rows[0];

        for (const sId of allStudentIds) {
          let state, grade, submittedAt, late, missing;

          if (sId === olubunmiId) {
            const p = OLUBUNMI_PATTERNS[ci][ai];
            state = p.state;
            if (p.state === 'MISSING') {
              grade = null;
              submittedAt = null;
              late = false;
              missing = true;
            } else if (p.state === 'LATE') {
              grade = p.grade;
              submittedAt = new Date(new Date(assignment.due_date).getTime() + 2 * 86400000);
              late = true;
              missing = false;
            } else {
              grade = p.grade;
              submittedAt = new Date(new Date(assignment.due_date).getTime() - 86400000); // on-time
              late = false;
              missing = false;
            }
          } else {
            // Classmates stay randomized — gives the teacher/admin roster realistic spread
            // for sorting/filtering without needing every student to be hand-scripted.
            const roll = Math.random();

            if (roll < 0.1) {
              state = 'MISSING';
              grade = null;
              submittedAt = null;
              late = false;
              missing = true;
            } else if (roll < 0.22) {
              state = 'LATE';
              grade = Math.floor(45 + Math.random() * 30);
              submittedAt = new Date(new Date(assignment.due_date).getTime() + 2 * 86400000);
              late = true;
              missing = false;
            } else {
              state = 'TURNED_IN';
              grade = Math.floor(65 + Math.random() * 35);
              submittedAt = new Date(new Date(assignment.due_date).getTime() - 86400000);
              late = false;
              missing = false;
            }
          }

          await client.query(
            `INSERT INTO submissions (assignment_id, user_id, state, grade, submitted_at, late, missing)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (assignment_id, user_id) DO UPDATE SET
               state = $3, grade = $4, submitted_at = $5, late = $6, missing = $7`,
            [assignment.id, sId, state, grade, submittedAt, late, missing]
          );
        }
      }
    }

    console.log('→ Computing initial risk scores...');
    for (const courseId of courseIds) {
      await recomputeForCourse(courseId);
    }

    console.log('\n✔ Seed complete.\n');
    console.log('Dev-login demo accounts (dev-only bypass, no Google account needed):');
    console.log('  olowookere.bunmi001@gmail.com  (Student — the Chapter 3 running example)');
    console.log('  teacher@demo.oau.edu.ng   (Teacher)');
    console.log('  admin@demo.oau.edu.ng     (Admin)\n');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    await redisClient.quit();
  }
}

run();
