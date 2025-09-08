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
    this.passwordHash = data.passwordHash;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.groups = data.groups || [];
    this.roles = data.roles || [];
    this.enabled = data.enabled !== false;
    this.emailVerified = data.emailVerified || false;
    this.syncStatus = data.syncStatus || 'synced'; // 'synced', 'conflict', 'error'
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.lastLogin = data.lastLogin;
    this.metadata = data.metadata || {};
    
    // Instance tracking metadata for conflict resolution
    this.instanceMetadata = data.instanceMetadata || {
      createdBy: process.env.INSTANCE_ID || 'unknown',
      createdAt: data.createdAt || new Date().toISOString(),
      lastModifiedBy: process.env.INSTANCE_ID || 'unknown',
      lastModifiedAt: data.updatedAt || new Date().toISOString(),
      version: data.instanceMetadata?.version || 1
    };
  }

  static async hashPassword(password) {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    return bcrypt.hash(password, rounds);
  }

  async verifyPassword(password) {
    return bcrypt.compare(password, this.passwordHash);
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
    this.lastLogin = new Date().toISOString();
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
    return this.enabled && this.syncStatus === 'synced';
  }

  // Update sync status based on conflict detection
  async checkAndUpdateSyncStatus() {
    try {
      const db = database.getDb();
      const doc = await db.get(this._id, { conflicts: true });
      
      if (doc._conflicts && doc._conflicts.length > 0) {
        // User has conflicts - mark as conflict status
        if (this.syncStatus !== 'conflict') {
          this.syncStatus = 'conflict';
          // Note: We don't save automatically here to avoid infinite loops
          // This should be called by a separate sync service
        }
      } else {
        // No conflicts - mark as synced
        if (this.syncStatus !== 'synced') {
          this.syncStatus = 'synced';
        }
      }
      
      return this.syncStatus;
    } catch (error) {
      console.error('Error checking sync status for user:', this._id, error);
      this.syncStatus = 'error';
      return this.syncStatus;
    }
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      username: this.username,
      email: this.email,
      passwordHash: this.passwordHash,
      firstName: this.firstName,
      lastName: this.lastName,
      groups: this.groups,
      roles: this.roles,
      enabled: this.enabled,
      emailVerified: this.emailVerified,
      syncStatus: this.syncStatus,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastLogin: this.lastLogin,
      metadata: this.metadata,
      instanceMetadata: this.instanceMetadata
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      username: this.username,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      groups: this.groups,
      roles: this.roles,
      enabled: this.enabled,
      emailVerified: this.emailVerified,
      syncStatus: this.syncStatus,
      createdAt: this.createdAt,
      lastLogin: this.lastLogin
    };
  }
}

module.exports = User;