const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const database = require('../database');

class User {
  constructor(data = {}) {
    this._id = data._id || `user:${uuidv4()}`;
    this._rev = data._rev;
    this.type = 'user';
    this.username = data.username;
    this.email = data.email;
    this.password_hash = data.password_hash || data.passwordHash;
    this.first_name = data.first_name || data.firstName;
    this.last_name = data.last_name || data.lastName;
    this.groups = data.groups || [];
    this.roles = data.roles || [];
    this.enabled = data.enabled !== false;
    this.email_verified = data.email_verified || data.emailVerified || false;
    this.sync_status = data.sync_status || data.syncStatus || 'synced'; // 'synced', 'conflict', 'error'
    this.created_at = data.created_at || data.createdAt || new Date().toISOString();
    this.updated_at = data.updated_at || data.updatedAt || new Date().toISOString();
    this.last_login = data.last_login || data.lastLogin;
    this.metadata = data.metadata || {};
    
    // Instance tracking metadata for conflict resolution
    this.instance_metadata = data.instance_metadata || data.instanceMetadata || {
      createdBy: process.env.INSTANCE_ID || 'unknown',
      createdAt: data.created_at || data.createdAt || new Date().toISOString(),
      lastModifiedBy: process.env.INSTANCE_ID || 'unknown',
      lastModifiedAt: data.updated_at || data.updatedAt || new Date().toISOString(),
      version: data.instanceMetadata?.version || 1
    };
  }

  static async hashPassword(password) {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    return bcrypt.hash(password, rounds);
  }

  async verifyPassword(password) {
    return bcrypt.compare(password, this.password_hash);
  }

  static async findByEmail(email) {
    try {
      const db = database.getDb();
      const result = await db.view('users', 'by_email', { 
        key: email, 
        include_docs: true 
      });
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0].doc);
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  }

  static async findByUsername(username) {
    try {
      const db = database.getDb();
      const result = await db.view('users', 'by_username', { 
        key: username, 
        include_docs: true 
      });
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0].doc);
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      const db = database.getDb();
      const doc = await db.get(id);
      return new User(doc);
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      console.error('Error finding user by ID:', error);
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
      console.error('Error saving user:', error);
      throw error;
    }
  }

  async delete() {
    try {
      const db = database.getDb();
      await db.destroy(this._id, this._rev);
      return true;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  updateLastLogin() {
    this.last_login = new Date().toISOString();
  }

  addGroup(group) {
    if (!this.groups.includes(group)) {
      this.groups.push(group);
    }
  }

  removeGroup(group) {
    this.groups = this.groups.filter(g => g !== group);
  }

  addRole(role) {
    if (!this.roles.includes(role)) {
      this.roles.push(role);
    }
  }

  removeRole(role) {
    this.roles = this.roles.filter(r => r !== role);
  }

  hasRole(role) {
    return this.roles.includes(role);
  }

  hasGroup(group) {
    return this.groups.includes(group);
  }

  // Check if user is effectively usable (enabled AND synced)
  isUsable() {
    return this.enabled && this.sync_status === 'synced';
  }

  // Update sync status based on conflict detection
  async checkAndUpdateSyncStatus() {
    try {
      const db = database.getDb();
      const doc = await db.get(this._id, { conflicts: true });
      
      if (doc._conflicts && doc._conflicts.length > 0) {
        // User has conflicts - mark as conflict status
        if (this.sync_status !== 'conflict') {
          this.sync_status = 'conflict';
          // Note: We don't save automatically here to avoid infinite loops
          // This should be called by a separate sync service
        }
      } else {
        // No conflicts - mark as synced
        if (this.sync_status !== 'synced') {
          this.sync_status = 'synced';
        }
      }
      
      return this.sync_status;
    } catch (error) {
      console.error('Error checking sync status for user:', this._id, error);
      this.sync_status = 'error';
      return this.sync_status;
    }
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      username: this.username,
      email: this.email,
      password_hash: this.password_hash,
      first_name: this.first_name,
      last_name: this.last_name,
      groups: this.groups,
      roles: this.roles,
      enabled: this.enabled,
      email_verified: this.email_verified,
      sync_status: this.sync_status,
      created_at: this.created_at,
      updated_at: this.updated_at,
      last_login: this.last_login,
      metadata: this.metadata,
      instance_metadata: this.instance_metadata
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      username: this.username,
      email: this.email,
      first_name: this.first_name,
      last_name: this.last_name,
      groups: this.groups,
      roles: this.roles,
      enabled: this.enabled,
      email_verified: this.email_verified,
      sync_status: this.sync_status,
      created_at: this.created_at,
      last_login: this.last_login
    };
  }
}

module.exports = User;