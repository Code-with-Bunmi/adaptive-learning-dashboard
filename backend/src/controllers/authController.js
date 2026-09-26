import pool from '../config/db.js';
import { signSession } from '../middleware/auth.js';
import { exchangeCodeForTokens, saveTokensForUser, upsertUserFromProfile } from '../services/googleAuthService.js';
import { determineRole } from '../services/classroomService.js';
import { OAuth2Client } from 'google-auth-library';

/**
 * POST /auth/google
 * Body: { code } — the one-time authorization code from the frontend's Google Identity
 * Services popup (auth-code flow). We exchange it server-side, determine role by actually
 * querying the Classroom API (never trusting a client-supplied role), and issue our own
 * session token.
 */
export async function googleLogin(req, res) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Missing authorization code.' });

    const { tokens, profile } = await exchangeCodeForTokens(code);

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, 'postmessage');
    client.setCredentials(tokens);

    const role = await determineRole(client);
    const user = await upsertUserFromProfile(profile, role);
    await saveTokensForUser(user.id, tokens);

    const session = signSession({ id: user.id, role: user.role, email: user.email, name: user.name });
    res.json({ token: session, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Google login failed:', err.message);
    res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
}

/** POST /auth/logout — stateless JWT, so this is really just a client-side signal, but kept as
 *  a real endpoint so the frontend has one consistent place to call and so a server-side
 *  session/token revocation list could be added later without changing the API contract. */
export async function logout(req, res) {
  res.json({ loggedOut: true });
}

/**
 * POST /auth/dev-login — DEV ONLY (see middleware/devLoginGuard.js, which 404s this entirely
 * outside development). Body: { email } of a seeded demo user. Lets you exercise every
 * dashboard without a real Google Workspace account.
 */
export async function devLogin(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required.' });

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.status(404).json({ error: 'No seeded user with that email. Run npm run seed.' });

    const user = rows[0];
    const session = signSession({ id: user.id, role: user.role, email: user.email, name: user.name });
    res.json({ token: session, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Dev login failed.' });
  }
}

/** GET /auth/me */
export async function me(req, res) {
  const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: rows[0] });
}
