const database = require('../database');

class Activity {
  constructor(data = {}) {
    this._id = data._id;
    this._rev = data._rev;
    this.type = 'activity';
    this.timestamp = data.timestamp || new Date().toISOString();
    this.action = data.action; // 'login', 'logout', 'user_created', 'user_updated', 'user_disabled', 'user_deleted', 'password_reset', 'session_invalidated'
    this.username = data.username;
    this.targetUserId = data.targetUserId; // For admin actions on other users
    this.targetUsername = data.targetUsername;
    this.ip = data.ip;
    this.userAgent = data.userAgent;
    this.adminUserId = data.adminUserId; // ID of admin who performed the action
    this.adminUsername = data.adminUsername; // Username of admin who performed the action
    this.details = data.details; // Additional details about the action
  }

  async save() {
    const db = database.getDb();
    
    if (this._id) {
      // Update existing
      const result = await db.insert(this.toJSON());
      this._rev = result.rev;
      return result;
    } else {
      // Create new
      const result = await db.insert(this.toJSON());
      this._id = result.id;
      this._rev = result.rev;
      return result;
    }
  }

  toJSON() {
    return {
      _id: this._id,
      _rev: this._rev,
      type: this.type,
      timestamp: this.timestamp,
      action: this.action,
      username: this.username,
      targetUserId: this.targetUserId,
      targetUsername: this.targetUsername,
      ip: this.ip,
      userAgent: this.userAgent,
      adminUserId: this.adminUserId,
      adminUsername: this.adminUsername,
      details: this.details
    };
  }

  toPublicJSON() {
    return {
      id: this._id,
      timestamp: this.timestamp,
      action: this.action,
      username: this.username,
      targetUsername: this.targetUsername,
      ip: this.ip,
      adminUsername: this.adminUsername,
      details: this.details,
      actionType: this.getActionType()
    };
  }

  getActionType() {
    // Return Bootstrap badge type based on action
    switch (this.action) {
      case 'login':
        return 'success';
      case 'logout':
        return 'info';
      case 'user_created':
        return 'success';
      case 'user_updated':
        return 'primary';
      case 'user_disabled':
        return 'warning';
      case 'user_deleted':
        return 'danger';
      case 'password_reset':
        return 'warning';
      case 'session_invalidated':
        return 'secondary';
      default:
        return 'secondary';
    }
  }

  // Static methods
  static async findRecent(limit = 10) {
    const db = database.getDb();
    
    try {
      const result = await db.view('activities', 'by_timestamp', {
        include_docs: true,
        descending: true,
        limit: limit
      });
      
      return result.rows.map(row => new Activity(row.doc));
    } catch (error) {
      if (error.statusCode === 404) {
        return [];
      }
      throw error;
    }
  }

  static async logActivity(action, data = {}) {
    const activity = new Activity({
      action,
      username: data.username,
      targetUserId: data.targetUserId,
      targetUsername: data.targetUsername,
      ip: data.ip,
      userAgent: data.userAgent,
      adminUserId: data.adminUserId,
      adminUsername: data.adminUsername,
      details: data.details
    });

    try {
      await activity.save();
      return activity;
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Don't throw error - activity logging shouldn't break the main functionality
      return null;
    }
  }
}

module.exports = Activity;