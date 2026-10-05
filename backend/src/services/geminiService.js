/**
 * The LLM's ONLY job (§2, §8): translate an already-computed risk score into encouraging,
 * specific, actionable feedback. It never sees raw grades and decides a score from them — it
 * receives the score AND the breakdown that scoringService already computed, and just writes
 * about it in plain English. Feedback is only generated for 'watch' or 'at_risk' students.
 *
 * Provider: Google Gemini (model: "gemini-3.6-flash", via the official @google/genai SDK.
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import pool from '../config/db.js';
import { cache } from '../config/redisClient.js';

dotenv.config();

const isConfigured = Boolean(process.env.GEMINI_API_KEY);
const TTL_HOURS = Number(process.env.AI_FEEDBACK_TTL_HOURS || 72);
const GEMINI_MODEL = 'gemini-2.5-flash';

let ai = null;
if (isConfigured) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// Kept as a named, tunable constant per §8 ("Prompt template stored in code").
export const FEEDBACK_PROMPT_TEMPLATE = ({ studentName, courseName, level, factors }) => `
You are a supportive academic advisor writing directly to a university student named ${studentName}
in the course "${courseName}". Their current standing is "${level === 'at_risk' ? 'At Risk' : 'Watch'}".

Here are the ONLY facts you may reference — do not invent any other data:
${factors.map((f) => `- ${f.label}: ${f.plainEnglish}`).join('\n')}

Write feedback (120-160 words) that:
1. Names the specific factor(s) above dragging their standing down, in the student's own plain
   English (never say "risk score" or mention weights/points).
2. Uses an encouraging, non-judgmental tone — the goal is motivation, never anxiety.
3. Gives exactly 3 concrete, actionable next steps tied to the facts given (e.g. "submit the
   missing assignment", "review the graded work you're behind on", "reach out to your instructor
   about upcoming due dates").
4. Never invents facts, names of assignments, or numbers beyond what's listed above.
Do not mention that this was AI-generated.
`.trim();

function cacheKeyFor(userId, courseId, riskScoreId) {
  return crypto.createHash('sha256').update(`${userId}:${courseId}:${riskScoreId}`).digest('hex');
}

/** Plain-language fallback used whenever Gemini isn't configured or a call fails. */
function templateFeedback({ studentName, level, factors }) {
  const firstName = studentName.split(' ')[0];
  const sorted = [...factors].sort((a, b) => b.contributionPoints - a.contributionPoints);
  const top = sorted[0];
  const second = sorted[1];

  const opener =
    level === 'at_risk'
      ? `Hi ${firstName}, a few things are pulling your standing down right now — all of them are fixable.`
      : `Hi ${firstName}, you're doing okay overall, with a couple of areas worth tightening up.`;

  return [
    opener,
    `The biggest factor is "${top.label}": ${top.plainEnglish}`,
    second ? `Also worth a look — "${second.label}": ${second.plainEnglish}` : '',
    'This week, try: (1) submit or catch up on your most recent outstanding work, (2) review feedback on your last graded item and note one thing to fix, and (3) reach out to your instructor if anything about upcoming deadlines is unclear.',
    "Small, consistent steps from here will show up quickly — you've got this.",
  ]
    .filter(Boolean)
    .join(' ');
}

/** Returns cached feedback if fresh, otherwise generates (Gemini or template) and caches it.
 *  Only ever called for 'watch' or 'at_risk' students — callers should gate on level first. */
export async function getOrGenerateFeedback({ student, course, riskScore }) {
  const key = cacheKeyFor(student.id, course.id, riskScore.id);
  const redisKey = `ai_feedback:${key}`;

  const cached = await cache.get(redisKey);
  if (cached) return { ...cached, cached: true };

  const { rows: dbCached } = await pool.query(
    `SELECT * FROM ai_feedback WHERE cache_key = $1 AND expires_at > NOW() ORDER BY generated_at DESC LIMIT 1`,
    [key]
  );
  if (dbCached.length) {
    await cache.set(redisKey, dbCached[0], TTL_HOURS * 3600);
    return { ...dbCached[0], cached: true };
  }

  const factors = riskScore.breakdown.factors;
  let content;

  if (isConfigured) {
    try {
      const prompt = FEEDBACK_PROMPT_TEMPLATE({
        studentName: student.name,
        courseName: course.name,
        level: riskScore.level,
        factors,
      });
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { maxOutputTokens: 2048, temperature: 0.7 },
      });

      // Log the raw structure (truncated) so we can see finishReason, parts, etc.
      console.log('[gemini] raw:', JSON.stringify(response).slice(0, 400));

      // Robust extraction: walk candidates[0].content.parts and join all text
      const parts = response.candidates?.[0]?.content?.parts || [];
      content = parts.map((p) => p.text || '').join('').trim();

      // Fallback to response.text if parts extraction gave nothing
      if (!content && typeof response.text === 'string') {
        content = response.text.trim();
      }

      console.log('[gemini] parts:', parts.length, '| extracted len:', content.length);
    } catch (err) {
      console.error('Gemini call failed, falling back to template:', err.message);
      content = templateFeedback({ studentName: student.name, level: riskScore.level, factors });
    }
  } else {
    content = templateFeedback({ studentName: student.name, level: riskScore.level, factors });
  }

  const { rows } = await pool.query(
    `INSERT INTO ai_feedback (user_id, course_id, content, cache_key, generated_at, expires_at)
     VALUES ($1,$2,$3,$4, NOW(), NOW() + ($5 || ' hours')::interval)
     RETURNING *`,
    [student.id, course.id, content, key, TTL_HOURS]
  );

  await cache.set(redisKey, rows[0], TTL_HOURS * 3600);
  return { ...rows[0], cached: false };
}

export { isConfigured };