const database = require('../database');

class DistributedSessionMiddleware {
  constructor() {
    this.sessionPrefix = 'session:';
  }

  // Get database instance
  getDb() {
    return database.getDb();
  }

  // Check if a session exists in CouchDB for any instance
  async findValidSession(userId) {
    try {
      // Look for any active session for this user
      const result = await this.getDb().list({
        startkey: this.sessionPrefix,
        endkey: this.sessionPrefix + '\ufff0',
        include_docs: true
      });

      for (const row of result.rows) {
        const doc = row.doc;
        if (doc && doc.type === 'express-session' && doc.session) {
          // Check if this session belongs to the user we're looking for
          if (doc.session.oidc_user && 
              doc.session.oidc_user.claims && 
              doc.session.oidc_user.claims.sub === userId) {
            
            // Check if session is not expired
            if (!doc.expires || doc.expires > Date.now()) {
              return {
                sessionId: row.id.replace(this.sessionPrefix, ''),
                sessionData: doc.session
              };
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding valid session:', error);
      return null;
    }
  }

  // Middleware to check for distributed sessions
  checkDistributedSession() {
    return async (req, res, next) => {
      // If user already has a local session, continue normally
      if (req.session.oidc_user) {
        return next();
      }

      // Check if there's a session token in query params or headers
      const sessionToken = req.query.session_token || req.headers['x-session-token'];
      
      if (sessionToken) {
        try {
          // Look up the session in CouchDB
          const sessionId = `${this.sessionPrefix}${sessionToken}`;
          const sessionDoc = await this.getDb().get(sessionId);
          
          if (sessionDoc && sessionDoc.session && 
              (!sessionDoc.expires || sessionDoc.expires > Date.now())) {
            
            // Copy the session data to current session
            req.session.oidc_user = sessionDoc.session.oidc_user;
            
            // Save the updated session
            await new Promise((resolve) => {
              req.session.save(resolve);
            });
            
            console.log('Distributed session restored for user:', 
              sessionDoc.session.oidc_user?.claims?.preferred_username);
          }
        } catch (error) {
          console.error('Error restoring distributed session:', error);
        }
      }

      next();
    };
  }

  // Generate a session sharing URL
  generateSessionUrl(req, targetUrl) {
    if (req.sessionID && req.session.oidc_user) {
      const url = new URL(targetUrl);
      url.searchParams.set('session_token', req.sessionID);
      return url.toString();
    }
    return targetUrl;
  }

  // Middleware to add session sharing URLs to templates
  addSessionUrls() {
    return (req, res, next) => {
      // Add helper function to templates
      res.locals.sessionUrl = (targetUrl) => {
        return this.generateSessionUrl(req, targetUrl);
      };
      
      // Add current session info
      res.locals.hasSession = !!req.session.oidc_user;
      res.locals.sessionId = req.sessionID;
      
      next();
    };
  }
}

module.exports = new DistributedSessionMiddleware();