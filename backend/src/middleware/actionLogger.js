/**
 * Logs authenticated user actions for the engagement-metrics requirement (§9), but only for
 * users who have given consent (users.consent_given). Runs after requireAuth, and is
 * fire-and-forget so a logging failure never blocks the actual request.
 */
import pool from '../config/db.js';

export function actionLogger(req, res, next) {
  res.on('finish', () => {
    if (!req.user) return;
    if (req.user.consentGiven === false) return;

    pool
      .query(
        `INSERT INTO interaction_logs (user_id, method, path, status_code) VALUES ($1,$2,$3,$4)`,
        [req.user.id, req.method, req.originalUrl, res.statusCode]
      )
      .catch((err) => console.error('Action logging failed (non-fatal):', err.message));
  });
  next();
}
