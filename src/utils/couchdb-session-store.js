const session = require('express-session');
const database = require('../database');

class CouchDBSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.prefix = options.prefix || 'session:';
    this.ttl = options.ttl || 24 * 60 * 60 * 1000; // 24 hours default
  }

  // Get database instance
  getDb() {
    return database.getDb();
  }

  // Get session document ID
  getSessionId(sid) {
    return `${this.prefix}${sid}`;
  }

  // Get session from CouchDB
  get(sid, callback) {
    const sessionId = this.getSessionId(sid);
    
    this.getDb().get(sessionId)
      .then(doc => {
        // Check if session has expired
        if (doc.expires && doc.expires < Date.now()) {
          // Session expired, remove it
          this.destroy(sid, () => {});
          return callback(null, null);
        }
        
        callback(null, doc.session);
      })
      .catch(err => {
        if (err.statusCode === 404) {
          // Session not found
          callback(null, null);
        } else {
          callback(err);
        }
      });
  }

  // Set session in CouchDB
  set(sid, session, callback) {
    const sessionId = this.getSessionId(sid);
    const expires = session.cookie && session.cookie.expires 
      ? new Date(session.cookie.expires).getTime()
      : Date.now() + this.ttl;
    
    const sessionDoc = {
      _id: sessionId,
      type: 'express-session',
      session: session,
      expires: expires,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Try to get existing document first to get _rev
    this.getDb().get(sessionId)
      .then(existingDoc => {
        sessionDoc._rev = existingDoc._rev;
        sessionDoc.createdAt = existingDoc.createdAt;
        return this.getDb().insert(sessionDoc);
      })
      .catch(err => {
        if (err.statusCode === 404) {
          // Document doesn't exist, create new one
          return this.getDb().insert(sessionDoc);
        }
        throw err;
      })
      .then(() => {
        callback(null);
      })
      .catch(err => {
        callback(err);
      });
  }

  // Destroy session in CouchDB
  destroy(sid, callback) {
    const sessionId = this.getSessionId(sid);
    
    this.getDb().get(sessionId)
      .then(doc => {
        return this.getDb().destroy(sessionId, doc._rev);
      })
      .then(() => {
        callback(null);
      })
      .catch(err => {
        if (err.statusCode === 404) {
          // Session already doesn't exist
          callback(null);
        } else {
          callback(err);
        }
      });
  }

  // Touch session (update expiration)
  touch(sid, session, callback) {
    // Just call set to update the session
    this.set(sid, session, callback);
  }

  // Get all sessions (optional, for admin purposes)
  all(callback) {
    const startKey = this.prefix;
    const endKey = this.prefix + '\ufff0';
    
    this.getDb().list({
      startkey: startKey,
      endkey: endKey,
      include_docs: true
    })
    .then(result => {
      const sessions = {};
      result.rows.forEach(row => {
        if (row.doc && row.doc.type === 'express-session') {
          const sid = row.id.replace(this.prefix, '');
          sessions[sid] = row.doc.session;
        }
      });
      callback(null, sessions);
    })
    .catch(err => {
      callback(err);
    });
  }

  // Clear all sessions (optional, for admin purposes)
  clear(callback) {
    const startKey = this.prefix;
    const endKey = this.prefix + '\ufff0';
    
    this.getDb().list({
      startkey: startKey,
      endkey: endKey,
      include_docs: true
    })
    .then(result => {
      const docsToDelete = result.rows.map(row => ({
        _id: row.id,
        _rev: row.doc._rev,
        _deleted: true
      }));
      
      if (docsToDelete.length > 0) {
        return this.getDb().bulk({ docs: docsToDelete });
      }
      return { results: [] };
    })
    .then(() => {
      callback(null);
    })
    .catch(err => {
      callback(err);
    });
  }

  // Get session count (optional, for admin purposes)
  length(callback) {
    const startKey = this.prefix;
    const endKey = this.prefix + '\ufff0';
    
    this.getDb().list({
      startkey: startKey,
      endkey: endKey
    })
    .then(result => {
      callback(null, result.rows.length);
    })
    .catch(err => {
      callback(err);
    });
  }
}

module.exports = CouchDBSessionStore;