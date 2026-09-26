import pool from '../config/db.js';

/**
 * Computes the standard System Usability Scale score (0-100) from 10 answers (1-5 each,
 * alternating positive/negative phrasing per the standard SUS instrument).
 * Odd-indexed (1,3,5,7,9) items: score = answer - 1
 * Even-indexed (2,4,6,8,10) items: score = 5 - answer
 * Sum * 2.5 = final 0-100 score.
 */
function computeSusScore(answers) {
  if (!Array.isArray(answers) || answers.length !== 10) {
    throw new Error('SUS requires exactly 10 answers (1-5 each).');
  }
  let sum = 0;
  answers.forEach((val, i) => {
    const n = Number(val);
    if (n < 1 || n > 5) throw new Error(`Answer ${i + 1} must be between 1 and 5.`);
    sum += i % 2 === 0 ? n - 1 : 5 - n;
  });
  return sum * 2.5;
}

/** POST /evaluation/sus — Body: { answers: number[10] } */
export async function submitSus(req, res) {
  try {
    const { answers } = req.body;
    const susScore = computeSusScore(answers);

    const { rows } = await pool.query(
      `INSERT INTO sus_responses (user_id, role, answers, sus_score) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, req.user.role, JSON.stringify(answers), susScore]
    );
    res.status(201).json({ response: rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** POST /evaluation/feedback — Body: { message } — free-text structured feedback */
export async function submitFeedback(req, res) {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required.' });

    const { rows } = await pool.query(
      `INSERT INTO evaluation_feedback (user_id, role, message) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.id, req.user.role, message.trim()]
    );
    res.status(201).json({ response: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit feedback.' });
  }
}
