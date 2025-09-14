export function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Login required.</p>' });
}

export function requireAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.level >= 9) return next();
  return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Admin required.</p>' });
}
