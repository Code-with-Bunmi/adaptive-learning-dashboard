/** Hard-disables the dev-login route in production, regardless of other config. */
export function devLoginGuard(req, res, next) {
  const enabled = process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN_ENABLED === 'true';
  if (!enabled) {
    return res.status(404).end(); // indistinguishable from a route that doesn't exist
  }
  next();
}
