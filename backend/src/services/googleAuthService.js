/**
 * Exchanges the one-time authorization code from the frontend's Google Identity Services popup
 * for real Google tokens, verifies identity, and persists the tokens for later Classroom calls.
 *
 * We NEVER see a Google password at any point — the browser only ever talks to Google directly;
 * all we receive is a short-lived code that's only useful in a single server-to-server exchange.
 */
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

// The popup-based "auth code" flow (@react-oauth/google, ux_mode: 'popup') requires the
// redirect_uri sent during token exchange to literally be the string "postmessage" — this is
// documented Google behavior, not a placeholder left unfinished.
const POPUP_REDIRECT_URI = 'postmessage';

function newClient() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, POPUP_REDIRECT_URI);
}

/** SHA-256 hash of the Google account's stable subject id — this is what we store as
 *  users.google_id, so the raw Google identifier never sits in our database. */
export function hashGoogleSub(sub) {
  return crypto.createHash('sha256').update(sub).digest('hex');
}

/** Exchanges the authorization code for tokens and returns { tokens, profile }. */
export async function exchangeCodeForTokens(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  return {
    tokens,
    profile: {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      hostedDomain: payload.hd || null, // present for Workspace accounts
    },
  };
}

export async function saveTokensForUser(userId, tokens) {
  await pool.query(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, scope, token_type, expiry_date, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       access_token = $2,
       refresh_token = COALESCE($3, google_tokens.refresh_token),
       scope = $4, token_type = $5, expiry_date = $6, updated_at = NOW()`,
    [userId, tokens.access_token, tokens.refresh_token || null, tokens.scope, tokens.token_type, tokens.expiry_date]
  );
}

export async function getTokensForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM google_tokens WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/** Builds an authorized OAuth2Client for a user, auto-persisting refreshed access tokens. */
export async function getAuthorizedClient(userId) {
  const stored = await getTokensForUser(userId);
  if (!stored) throw new Error('No Google tokens on file for this user.');

  const client = newClient();
  client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    scope: stored.scope,
    token_type: stored.token_type,
    expiry_date: stored.expiry_date ? Number(stored.expiry_date) : undefined,
  });

  client.on('tokens', (tokens) => {
    saveTokensForUser(userId, { ...stored, ...tokens }).catch((err) =>
      console.error('Failed to persist refreshed Google token:', err.message)
    );
  });

  return client;
}

/** Finds or creates a local user row from a verified Google profile, hashing the subject id. */
export async function upsertUserFromProfile(profile, role) {
  const googleIdHash = hashGoogleSub(profile.sub);

  const { rows: existing } = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleIdHash]);
  if (existing.length) {
    // Role can change over time (e.g. a student becomes a TA/teacher) — keep it current.
    if (role && existing[0].role !== role) {
      const { rows: updated } = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [
        role,
        existing[0].id,
      ]);
      return updated[0];
    }
    return existing[0];
  }

  const { rows } = await pool.query(
  `INSERT INTO users (google_id, email, name, role) VALUES ($1,$2,$3,$4)
   ON CONFLICT (email) DO UPDATE SET
     google_id = EXCLUDED.google_id,
     name = EXCLUDED.name
   RETURNING *`,
  [googleIdHash, profile.email, profile.name, role]
);
return rows[0];
}
