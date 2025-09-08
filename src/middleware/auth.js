const User = require('../models/User');

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/admin/login');
  }
  
  // Load user and check admin role
  User.findById(req.session.userId)
    .then(user => {
      if (!user || !user.isUsable() || !user.hasRole('admin')) {
        req.session.destroy();
        const errorType = !user ? 'access_denied' : 
                         !user.enabled ? 'account_disabled' : 
                         user.syncStatus !== 'synced' ? 'account_sync_conflict' : 
                         'access_denied';
        return res.redirect(`/admin/login?error=${errorType}`);
      }
      
      req.user = user;
      next();
    })
    .catch(error => {
      console.error('Auth middleware error:', error);
      req.session.destroy();
      res.redirect('/admin/login?error=server_error');
    });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/admin/login');
  }
  
  User.findById(req.session.userId)
    .then(user => {
      if (!user || !user.isUsable()) {
        req.session.destroy();
        const errorType = !user ? 'account_not_found' : 
                         !user.enabled ? 'account_disabled' : 
                         'account_sync_conflict';
        return res.redirect(`/admin/login?error=${errorType}`);
      }
      
      req.user = user;
      next();
    })
    .catch(error => {
      console.error('Auth middleware error:', error);
      req.session.destroy();
      res.redirect('/admin/login?error=server_error');
    });
}

module.exports = {
  requireAdmin,
  requireAuth
};