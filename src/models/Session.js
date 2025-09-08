const { v4: uuidv4 } = require('uuid');
const database = require('../database');

class Session {
  constructor(data = {}) {
    this._id = data._id || `session:${uuidv4()}`;
    this._rev = data._rev;
    this.type = 'session';
    this.userId = data.userId;
    this.clientId = data.clientId;
    this.redirectUri = data.redirectUri;
    this.scopes = data.scopes || [];
    this.authorizationCode = data.authorizationCode;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.idToken = data.idToken;
    this.nonce = data.nonce;
    this.active = data.active !== false;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.expiresAt = data.expiresAt;
    this.lastAccessedAt = data.lastAccessedAt;
    
    // Instance metadata for cluster tracking
    this.instanceMetadata = data.instanceMetadata || {
      version: data.instanceMetadata?.version || 1
    };
  }

  static async findByAuthCode(authCode) {
    try {
      const db = database.getDb();
      const result = await db.view('sessions', 'by_auth_code', { 
        key: authCode, 
        include_docs: true 
      });
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new Session(result.rows[0].doc);
    } catch (error) {
      console.error('Error finding session by auth code:', error);
      throw error;
    }
  }

  static async findByUserId(userId) {
    try {
      const db = database.getDb();
      const result = await db.view('sessions', 'by_user_id', { 
        key: userId, 
        include_docs: true 
      });
      
      return result.rows.map(row => new Session(row.doc));
    } catch (error) {
      console.error('Error finding sessions by user ID:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      const db = database.getDb();
      const doc = await db.get(id);
      return new Session(doc);
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      console.error('Error finding session by ID:', error);
      throw error;
    }
  }

  async save() {
    try {
      const db = database.getDb();
      const now = new Date().toISOString();
      const instanceId = process.env.INSTANCE_ID || 'unknown';
      
      this.updatedAt = now;
      
      // Update instance metadata
      if (!this.instanceMetadata.createdBy) {
        this.instanceMetadata.createdBy = instanceId;
        this.instanceMetadata.createdAt = this.createdAt;
      }
      this.instanceMetadata.lastModifiedBy = instanceId;
      this.instanceMetadata.lastModifiedAt = now;
      this.instanceMetadata.version = (this.instanceMetadata.version || 1) + 1;
      
      const result = await db.insert(this.toJSON());
      this._rev = result.rev;
      return this;
    } catch (error) {
      console.error('Error saving session:', error);
      throw error;
    }
  }

  async delete() {
    try {
      const db = database.getDb();
      await db.destroy(this._id, this._rev);
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      throw error;
    }
  }

  async invalidate() {
    this.active = false;
    this.updatedAt = new Date().toISOString();
    return this.save();
  }

  updateLastAccessed() {
    this.lastAccessedAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  isExpired() {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }

  setTokens(accessToken, refreshToken = null, idToken = null) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.idToken = idToken;
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      userId: this.userId,
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      scopes: this.scopes,
      authorizationCode: this.authorizationCode,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      idToken: this.idToken,
      nonce: this.nonce,
      active: this.active,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      expiresAt: this.expiresAt,
      lastAccessedAt: this.lastAccessedAt,
      instanceMetadata: this.instanceMetadata
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      userId: this.userId,
      clientId: this.clientId,
      scopes: this.scopes,
      active: this.active,
      createdAt: this.createdAt,
      lastAccessedAt: this.lastAccessedAt,
      expiresAt: this.expiresAt
    };
  }
}

module.exports = Session;