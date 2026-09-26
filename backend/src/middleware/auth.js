import jwt from 'jsonwebtoken';

/** Verifies OUR session JWT (issued after Google OAuth + role resolution). Not a Google token. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.session;

  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  try {
    req.user = jwt.verify(token, process.env.SESSION_JWT_SECRET); // { id, role, email, name }
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

export function signSession(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, name: user.name },
    process.env.SESSION_JWT_SECRET,
    { expiresIn: process.env.SESSION_JWT_EXPIRES_IN || '7d' }
  );
}
