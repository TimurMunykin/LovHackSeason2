const DEV_USER = {
  id: 'dev-user-local',
  name: 'Dev User',
  email: 'dev@localhost',
  avatarUrl: null,
};

function requireAuth(req, res, next) {
  if (process.env.DEV_AUTH_BYPASS === 'true') {
    req.user = DEV_USER;
    return next();
  }
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

module.exports = { requireAuth, DEV_USER };
