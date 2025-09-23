const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const database = require('../database');

class Client {
  constructor(data = {}) {
    this._id = data._id || `client:${uuidv4()}`;
    this._rev = data._rev;
    this.type = 'client';
    this.client_id = data.client_id || this.generateClientId();
    this.client_secret = data.client_secret || this.generateClientSecret();
    this.name = data.name;
    this.description = data.description;
    this.redirect_uris = data.redirect_uris || [];
    this.scopes = data.scopes || ['openid', 'profile', 'email'];
    this.grant_types = data.grant_types || ['authorization_code', 'refresh_token'];
    this.response_types = data.response_types || ['code'];
    this.enabled = data.enabled !== false;
    this.confidential = data.confidential !== false; // public vs confidential client
    this.created_at = data.created_at || new Date().toISOString();
    this.updated_at = data.updated_at || new Date().toISOString();
    this.metadata = data.metadata || {};
    
    // Instance metadata for cluster tracking
    this.instance_metadata = data.instance_metadata || {
      version: data.instance_metadata?.version || 1
    };
  }

  generateClientId() {
    return `client_${crypto.randomBytes(16).toString('hex')}`;
  }

  generateClientSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  static async findByClientId(clientId) {
    try {
      const db = database.getDb();
      const result = await db.view('clients', 'by_client_id', { 
        key: clientId, 
        include_docs: true 
      });
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new Client(result.rows[0].doc);
    } catch (error) {
      console.error('Error finding client by client ID:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      const db = database.getDb();
      const doc = await db.get(id);
      return new Client(doc);
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      console.error('Error finding client by ID:', error);
      throw error;
    }
  }

  static async findAll() {
    try {
      const db = database.getDb();
      const result = await db.view('clients', 'by_name', { include_docs: true });
      return result.rows.map(row => new Client(row.doc));
    } catch (error) {
      if (error.statusCode === 404) {
        return [];
      }
      console.error('Error finding all clients:', error);
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
      console.log(`Client ${this.client_id} save() - instance_metadata before:`, this.instance_metadata);
      if (!this.instance_metadata.createdBy) {
        this.instance_metadata.createdBy = instanceId;
        this.instance_metadata.createdAt = this.created_at;
        console.log(`Client ${this.client_id} - Setting createdBy to ${instanceId} and createdAt to ${this.created_at}`);
      }
      this.instance_metadata.lastModifiedBy = instanceId;
      this.instance_metadata.lastModifiedAt = now;
      this.instance_metadata.version = (this.instance_metadata.version || 1) + 1;
      console.log(`Client ${this.client_id} save() - instance_metadata after:`, this.instance_metadata);
      
      const result = await db.insert(this.toJSON());
      this._rev = result.rev;
      return this;
    } catch (error) {
      console.error('Error saving client:', error);
      throw error;
    }
  }

  async delete() {
    try {
      const db = database.getDb();
      await db.destroy(this._id, this._rev);
      return true;
    } catch (error) {
      console.error('Error deleting client:', error);
      throw error;
    }
  }

  // Validate client credentials
  validateSecret(providedSecret) {
    return this.client_secret === providedSecret;
  }

  // Check if redirect URI is allowed
  isRedirectUriAllowed(uri) {
    return this.redirect_uris.includes(uri);
  }

  // Check if scope is allowed
  isScopeAllowed(scope) {
    const requestedScopes = Array.isArray(scope) ? scope : scope.split(' ');
    return requestedScopes.every(s => this.scopes.includes(s));
  }

  // Check if grant type is allowed
  isGrantTypeAllowed(grantType) {
    return this.grant_types.includes(grantType);
  }

  // Check if response type is allowed
  isResponseTypeAllowed(responseType) {
    return this.response_types.includes(responseType);
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      client_id: this.client_id,
      client_secret: this.client_secret,
      name: this.name,
      description: this.description,
      redirect_uris: this.redirect_uris,
      scopes: this.scopes,
      grant_types: this.grant_types,
      response_types: this.response_types,
      enabled: this.enabled,
      confidential: this.confidential,
      created_at: this.created_at,
      updated_at: this.updated_at,
      metadata: this.metadata,
      instance_metadata: this.instance_metadata
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      client_id: this.client_id,
      name: this.name,
      description: this.description,
      redirect_uris: this.redirect_uris,
      scopes: this.scopes,
      grant_types: this.grant_types,
      response_types: this.response_types,
      enabled: this.enabled,
      confidential: this.confidential,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  // Return safe version for client credentials display (mask secret)
  toSafeJSON() {
    const safe = this.toPublicJSON();
    safe.client_secret = this.client_secret ? '••••••••' + this.client_secret.slice(-4) : null;
    
    // Include syncStatus if it exists (for UI display)
    if (this.syncStatus) {
      safe.syncStatus = this.syncStatus;
    }
    
    return safe;
  }
}

module.exports = Client;