const sessions = require('express-session');

class SessionManager {
  constructor() {
    if (!global.userSessionMap) {
      global.userSessionMap = new Map();
    }
    if (!global.sessionStore) {
      global.sessionStore = new Map();
    }
  }

  // Register a session for a user
  registerUserSession(userId, sessionId) {
    global.userSessionMap.set(userId, sessionId);
  }

  // Remove session mapping
  removeUserSession(userId) {
    global.userSessionMap.delete(userId);
  }

  // Get session ID for user
  getUserSessionId(userId) {
    return global.userSessionMap.get(userId);
  }

  // Destroy a user's Express session by user ID
  async destroyUserSession(userId) {
    const sessionId = this.getUserSessionId(userId);
    if (!sessionId) {
      return false; // No session found for this user
    }

    return new Promise((resolve) => {
      // For default memory store, we need to access the sessions directly
      const MemoryStore = sessions.MemoryStore;
      if (global.sessionStore instanceof MemoryStore) {
        global.sessionStore.destroy(sessionId, (err) => {
          if (!err) {
            this.removeUserSession(userId);
          }
          resolve(!err);
        });
      } else {
        // For other stores, try to destroy directly
        try {
          delete global.sessionStore[sessionId];
          this.removeUserSession(userId);
          resolve(true);
        } catch (err) {
          resolve(false);
        }
      }
    });
  }

  // Set session store reference
  setSessionStore(store) {
    global.sessionStore = store;
  }
}

module.exports = new SessionManager();