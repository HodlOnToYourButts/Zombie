const { v4: uuidv4 } = require('uuid');
const database = require('../database');

class Session {
  constructor(data = {}) {
    this._id = data._id || `session:${uuidv4()}`;
    this._rev = data._rev;
    this.type = 'session';
    this.user_id = data.user_id || data.userId;
    this.client_id = data.client_id || data.clientId;
    this.redirect_uri = data.redirect_uri || data.redirectUri;
    this.scopes = data.scopes || [];
    this.authorization_code = data.authorization_code || data.authorizationCode;
    this.access_token = data.access_token || data.accessToken;
    this.refresh_token = data.refresh_token || data.refreshToken;
    this.id_token = data.id_token || data.idToken;
    this.nonce = data.nonce;
    this.active = data.active !== false;
    this.created_at = data.created_at || data.createdAt || new Date().toISOString();
    this.updated_at = data.updated_at || data.updatedAt || new Date().toISOString();
    this.expires_at = data.expires_at || data.expiresAt;
    this.last_accessed_at = data.last_accessed_at || data.lastAccessedAt;
    
    // Instance metadata for cluster tracking
    this.instance_metadata = data.instance_metadata || data.instanceMetadata || {
      version: data.instance_metadata?.version || data.instanceMetadata?.version || 1
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
      
      this.updated_at = now;
      
      // Update instance metadata
      if (!this.instance_metadata.createdBy) {
        this.instance_metadata.createdBy = instanceId;
        this.instance_metadata.createdAt = this.created_at;
      }
      this.instance_metadata.lastModifiedBy = instanceId;
      this.instance_metadata.lastModifiedAt = now;
      this.instance_metadata.version = (this.instance_metadata.version || 1) + 1;
      
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
    this.updated_at = new Date().toISOString();
    return this.save();
  }

  updateLastAccessed() {
    this.last_accessed_at = new Date().toISOString();
    this.updated_at = new Date().toISOString();
  }

  isExpired() {
    if (!this.expires_at) return false;
    return new Date() > new Date(this.expires_at);
  }

  setTokens(accessToken, refreshToken = null, idToken = null) {
    this.access_token = accessToken;
    this.refresh_token = refreshToken;
    this.id_token = idToken;
    this.updated_at = new Date().toISOString();
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      user_id: this.user_id,
      client_id: this.client_id,
      redirect_uri: this.redirect_uri,
      scopes: this.scopes,
      authorization_code: this.authorization_code,
      access_token: this.access_token,
      refresh_token: this.refresh_token,
      id_token: this.id_token,
      nonce: this.nonce,
      active: this.active,
      created_at: this.created_at,
      updated_at: this.updated_at,
      expires_at: this.expires_at,
      last_accessed_at: this.last_accessed_at,
      instance_metadata: this.instance_metadata
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      user_id: this.user_id,
      client_id: this.client_id,
      scopes: this.scopes,
      active: this.active,
      created_at: this.created_at,
      last_accessed_at: this.last_accessed_at,
      expires_at: this.expires_at
    };
  }
}

module.exports = Session;