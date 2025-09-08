const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const database = require('../database');

class Client {
  constructor(data = {}) {
    this._id = data._id || `client:${uuidv4()}`;
    this._rev = data._rev;
    this.type = 'client';
    this.clientId = data.clientId || this.generateClientId();
    this.clientSecret = data.clientSecret || this.generateClientSecret();
    this.name = data.name;
    this.description = data.description;
    this.redirectUris = data.redirectUris || [];
    this.scopes = data.scopes || ['openid', 'profile', 'email'];
    this.grantTypes = data.grantTypes || ['authorization_code', 'refresh_token'];
    this.responseTypes = data.responseTypes || ['code'];
    this.enabled = data.enabled !== false;
    this.confidential = data.confidential !== false; // public vs confidential client
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.metadata = data.metadata || {};
    
    // Instance metadata for cluster tracking
    this.instanceMetadata = data.instanceMetadata || {
      version: data.instanceMetadata?.version || 1
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
      
      this.updatedAt = now;
      
      // Update instance metadata
      console.log(`Client ${this.clientId} save() - instanceMetadata before:`, this.instanceMetadata);
      if (!this.instanceMetadata.createdBy) {
        this.instanceMetadata.createdBy = instanceId;
        this.instanceMetadata.createdAt = this.createdAt;
        console.log(`Client ${this.clientId} - Setting createdBy to ${instanceId} and createdAt to ${this.createdAt}`);
      }
      this.instanceMetadata.lastModifiedBy = instanceId;
      this.instanceMetadata.lastModifiedAt = now;
      this.instanceMetadata.version = (this.instanceMetadata.version || 1) + 1;
      console.log(`Client ${this.clientId} save() - instanceMetadata after:`, this.instanceMetadata);
      
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
    return this.clientSecret === providedSecret;
  }

  // Check if redirect URI is allowed
  isRedirectUriAllowed(uri) {
    return this.redirectUris.includes(uri);
  }

  // Check if scope is allowed
  isScopeAllowed(scope) {
    const requestedScopes = Array.isArray(scope) ? scope : scope.split(' ');
    return requestedScopes.every(s => this.scopes.includes(s));
  }

  // Check if grant type is allowed
  isGrantTypeAllowed(grantType) {
    return this.grantTypes.includes(grantType);
  }

  // Check if response type is allowed
  isResponseTypeAllowed(responseType) {
    return this.responseTypes.includes(responseType);
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      name: this.name,
      description: this.description,
      redirectUris: this.redirectUris,
      scopes: this.scopes,
      grantTypes: this.grantTypes,
      responseTypes: this.responseTypes,
      enabled: this.enabled,
      confidential: this.confidential,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
      instanceMetadata: this.instanceMetadata
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      clientId: this.clientId,
      name: this.name,
      description: this.description,
      redirectUris: this.redirectUris,
      scopes: this.scopes,
      grantTypes: this.grantTypes,
      responseTypes: this.responseTypes,
      enabled: this.enabled,
      confidential: this.confidential,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Return safe version for client credentials display (mask secret)
  toSafeJSON() {
    const safe = this.toPublicJSON();
    safe.clientSecret = this.clientSecret ? '••••••••' + this.clientSecret.slice(-4) : null;
    
    // Include syncStatus if it exists (for UI display)
    if (this.syncStatus) {
      safe.syncStatus = this.syncStatus;
    }
    
    return safe;
  }
}

module.exports = Client;