const database = require('../database');
const User = require('../models/User');
const ConflictDetector = require('./conflict-detector');

class SyncMonitor {
  constructor() {
    this.conflictDetector = new ConflictDetector();
    this.monitoring = false;
    this.intervalId = null;
  }

  async initialize() {
    await this.conflictDetector.initialize();
  }

  // Start monitoring for conflicts and updating user sync status
  startMonitoring(intervalMs = 30000) { // Check every 30 seconds by default
    if (this.monitoring) {
      console.log('Sync monitor already running');
      return;
    }

    this.monitoring = true;
    console.log(`Starting sync monitor (checking every ${intervalMs}ms)`);

    this.intervalId = setInterval(async () => {
      try {
        await this.checkAndUpdateAllUserSyncStatus();
      } catch (error) {
        console.error('Error in sync monitor:', error);
      }
    }, intervalMs);
  }

  stopMonitoring() {
    if (!this.monitoring) {
      return;
    }

    console.log('Stopping sync monitor');
    this.monitoring = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkAndUpdateAllUserSyncStatus() {
    try {
      const db = database.getDb();
      
      // Get all user documents
      const result = await db.view('users', 'by_username', { include_docs: true });
      
      let syncUpdates = 0;
      let conflictUsers = 0;
      
      for (const row of result.rows) {
        const userData = row.doc;
        const user = new User(userData);
        const previousSyncStatus = user.syncStatus;
        
        // Check current conflict status
        await user.checkAndUpdateSyncStatus();
        
        // If sync status changed, update the document
        if (user.syncStatus !== previousSyncStatus) {
          try {
            // Get the latest revision to ensure we have the most current document
            const currentDoc = await db.get(user._id);
            
            // Update only the syncStatus field
            currentDoc.syncStatus = user.syncStatus;
            currentDoc.updatedAt = new Date().toISOString();
            
            // Update instance metadata
            currentDoc.instanceMetadata = {
              ...currentDoc.instanceMetadata,
              lastModifiedBy: process.env.INSTANCE_ID || 'sync-monitor',
              lastModifiedAt: new Date().toISOString(),
              version: (currentDoc.instanceMetadata?.version || 1) + 1
            };
            
            await db.insert(currentDoc);
            syncUpdates++;
            
            console.log(`Updated sync status for user ${user.username}: ${previousSyncStatus} → ${user.syncStatus}`);
          } catch (updateError) {
            console.error(`Failed to update sync status for user ${user.username}:`, updateError);
          }
        }
        
        if (user.syncStatus === 'conflict') {
          conflictUsers++;
        }
      }
      
      if (syncUpdates > 0 || conflictUsers > 0) {
        console.log(`Sync monitor: Updated ${syncUpdates} users, ${conflictUsers} users with conflicts`);
      }
      
    } catch (error) {
      console.error('Error checking user sync status:', error);
    }
  }

  // Manual trigger for sync status check
  async checkUserSyncStatus(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      const previousSyncStatus = user.syncStatus;
      await user.checkAndUpdateSyncStatus();
      
      if (user.syncStatus !== previousSyncStatus) {
        await user.save();
        console.log(`Updated sync status for user ${user.username}: ${previousSyncStatus} → ${user.syncStatus}`);
      }
      
      return {
        userId: user._id,
        username: user.username,
        previousSyncStatus,
        currentSyncStatus: user.syncStatus,
        updated: user.syncStatus !== previousSyncStatus
      };
      
    } catch (error) {
      console.error(`Error checking sync status for user ${userId}:`, error);
      throw error;
    }
  }

  // Get sync statistics
  async getSyncStats() {
    try {
      const db = database.getDb();
      const result = await db.view('users', 'by_username', { include_docs: true });
      
      const stats = {
        total: 0,
        synced: 0,
        conflicts: 0,
        errors: 0,
        unknown: 0
      };
      
      for (const row of result.rows) {
        const user = new User(row.doc);
        stats.total++;
        
        switch (user.syncStatus) {
          case 'synced':
            stats.synced++;
            break;
          case 'conflict':
            stats.conflicts++;
            break;
          case 'error':
            stats.errors++;
            break;
          default:
            stats.unknown++;
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Error getting sync stats:', error);
      throw error;
    }
  }
}

module.exports = SyncMonitor;