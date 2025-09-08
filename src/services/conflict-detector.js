const database = require('../database');

class ConflictDetector {
  constructor() {
    this.db = null;
  }

  async initialize() {
    this.db = database.getDb();
    
    // Create design document for conflict detection views
    await this.createConflictViews();
  }

  async createConflictViews() {
    const conflictDesignDoc = {
      _id: '_design/conflicts',
      views: {
        all_conflicts: {
          map: function(doc) {
            if (doc._conflicts && doc._conflicts.length > 0) {
              emit([doc.type, doc._id], {
                id: doc._id,
                type: doc.type,
                conflicts: doc._conflicts,
                instanceMetadata: doc.instanceMetadata
              });
            }
          }.toString()
        },
        user_conflicts: {
          map: function(doc) {
            if (doc.type === 'user' && doc._conflicts && doc._conflicts.length > 0) {
              emit(doc._id, {
                id: doc._id,
                username: doc.username,
                email: doc.email,
                groups: doc.groups,
                conflicts: doc._conflicts,
                instanceMetadata: doc.instanceMetadata
              });
            }
          }.toString()
        },
        client_conflicts: {
          map: function(doc) {
            if (doc.type === 'client' && doc._conflicts && doc._conflicts.length > 0) {
              emit(doc._id, {
                id: doc._id,
                clientId: doc.clientId,
                name: doc.name,
                conflicts: doc._conflicts,
                instanceMetadata: doc.instanceMetadata
              });
            }
          }.toString()
        }
      }
    };

    try {
      await this.db.insert(conflictDesignDoc);
      console.log('Created conflict detection views');
    } catch (error) {
      if (error.statusCode !== 409) { // 409 = conflict (already exists)
        console.error('Error creating conflict views:', error);
      }
    }
  }

  async getAllConflicts() {
    try {
      const result = await this.db.view('conflicts', 'all_conflicts', {
        include_docs: true
      });
      
      const conflicts = [];
      
      for (const row of result.rows) {
        const conflictInfo = await this.analyzeConflict(row.doc);
        conflicts.push(conflictInfo);
      }
      
      return conflicts;
    } catch (error) {
      console.error('Error getting all conflicts:', error);
      return [];
    }
  }

  async getUserConflicts() {
    try {
      const result = await this.db.view('conflicts', 'user_conflicts', {
        include_docs: false  // We'll get documents manually to ensure conflicts are included
      });
      
      const conflicts = [];
      
      for (const row of result.rows) {
        try {
          // Get the document with conflicts explicitly
          const doc = await this.db.get(row.id, { conflicts: true });
          const conflictInfo = await this.analyzeUserConflict(doc);
          conflicts.push(conflictInfo);
        } catch (docError) {
          console.warn(`Could not analyze conflict for user ${row.id}:`, docError.message);
        }
      }
      
      return conflicts;
    } catch (error) {
      console.error('Error getting user conflicts:', error);
      return [];
    }
  }

  async analyzeConflict(doc) {
    const conflictVersions = [];
    
    // Get the current winning version
    conflictVersions.push({
      version: 'current',
      rev: doc._rev,
      data: doc,
      instanceMetadata: doc.instanceMetadata
    });
    
    // Get all conflicting versions
    for (const conflictRev of doc._conflicts || []) {
      try {
        const conflictDoc = await this.db.get(doc._id, { rev: conflictRev });
        conflictVersions.push({
          version: 'conflict',
          rev: conflictRev,
          data: conflictDoc,
          instanceMetadata: conflictDoc.instanceMetadata
        });
      } catch (error) {
        console.warn(`Could not retrieve conflict version ${conflictRev} for ${doc._id}`);
      }
    }
    
    return {
      documentId: doc._id,
      documentType: doc.type,
      conflictCount: doc._conflicts ? doc._conflicts.length : 0,
      versions: conflictVersions,
      analysis: this.analyzeConflictType(conflictVersions),
      detectedAt: new Date().toISOString()
    };
  }

  async analyzeUserConflict(userDoc) {
    const conflictVersions = [];
    
    // Get current version
    conflictVersions.push({
      version: 'current',
      rev: userDoc._rev,
      username: userDoc.username,
      email: userDoc.email,
      groups: userDoc.groups || [],
      roles: userDoc.roles || [],
      enabled: userDoc.enabled,
      instanceMetadata: userDoc.instanceMetadata
    });
    
    // Get conflicting versions
    for (const conflictRev of userDoc._conflicts || []) {
      try {
        const conflictDoc = await this.db.get(userDoc._id, { rev: conflictRev });
        conflictVersions.push({
          version: 'conflict',
          rev: conflictRev,
          username: conflictDoc.username,
          email: conflictDoc.email,
          groups: conflictDoc.groups || [],
          roles: conflictDoc.roles || [],
          enabled: conflictDoc.enabled,
          instanceMetadata: conflictDoc.instanceMetadata
        });
      } catch (error) {
        console.warn(`Could not retrieve conflict version ${conflictRev} for user ${userDoc._id}`);
      }
    }
    
    return {
      userId: userDoc._id,
      username: userDoc.username,
      email: userDoc.email,
      conflictType: this.analyzeUserConflictType(conflictVersions),
      versions: conflictVersions,
      suggestedResolution: this.suggestUserResolution(conflictVersions),
      detectedAt: new Date().toISOString()
    };
  }

  analyzeConflictType(versions) {
    if (versions.length < 2) return 'no_conflict';
    
    const instancesInvolved = new Set();
    let hasDataDifferences = false;
    
    for (const version of versions) {
      if (version.instanceMetadata?.lastModifiedBy) {
        instancesInvolved.add(version.instanceMetadata.lastModifiedBy);
      }
    }
    
    // Compare data between versions to detect actual differences
    const firstData = versions[0].data;
    for (let i = 1; i < versions.length; i++) {
      if (this.hasSignificantDifferences(firstData, versions[i].data)) {
        hasDataDifferences = true;
        break;
      }
    }
    
    return {
      type: hasDataDifferences ? 'data_conflict' : 'revision_conflict',
      instancesInvolved: Array.from(instancesInvolved),
      requiresManualResolution: hasDataDifferences
    };
  }

  analyzeUserConflictType(versions) {
    if (versions.length < 2) return 'no_conflict';
    
    const conflicts = {
      groups: false,
      roles: false,
      enabled: false,
      profile: false
    };
    
    const baseVersion = versions[0];
    
    for (let i = 1; i < versions.length; i++) {
      const version = versions[i];
      
      // Check groups conflict
      if (!this.arraysEqual(baseVersion.groups, version.groups)) {
        conflicts.groups = true;
      }
      
      // Check roles conflict
      if (!this.arraysEqual(baseVersion.roles, version.roles)) {
        conflicts.roles = true;
      }
      
      // Check enabled status
      if (baseVersion.enabled !== version.enabled) {
        conflicts.enabled = true;
      }
      
      // Check profile info (username, email)
      if (baseVersion.username !== version.username || baseVersion.email !== version.email) {
        conflicts.profile = true;
      }
    }
    
    return conflicts;
  }

  suggestUserResolution(versions) {
    const suggestions = {};
    
    if (versions.length < 2) return suggestions;
    
    // Suggest keeping the most recent version based on lastModifiedAt
    let mostRecentVersion = versions[0];
    for (const version of versions) {
      if (version.instanceMetadata?.lastModifiedAt > mostRecentVersion.instanceMetadata?.lastModifiedAt) {
        mostRecentVersion = version;
      }
    }
    
    suggestions.keepMostRecent = {
      version: mostRecentVersion.version,
      rev: mostRecentVersion.rev,
      modifiedBy: mostRecentVersion.instanceMetadata?.lastModifiedBy,
      modifiedAt: mostRecentVersion.instanceMetadata?.lastModifiedAt
    };
    
    // Suggest merging groups and roles from all versions
    const allGroups = new Set();
    const allRoles = new Set();
    
    for (const version of versions) {
      for (const group of version.groups || []) {
        allGroups.add(group);
      }
      for (const role of version.roles || []) {
        allRoles.add(role);
      }
    }
    
    suggestions.mergePermissions = {
      groups: Array.from(allGroups),
      roles: Array.from(allRoles)
    };
    
    return suggestions;
  }

  hasSignificantDifferences(doc1, doc2) {
    // Skip internal CouchDB fields and metadata that don't represent actual conflicts
    const ignoreFields = ['_rev', '_conflicts', 'updatedAt', 'instanceMetadata'];
    
    for (const key in doc1) {
      if (ignoreFields.includes(key)) continue;
      
      if (JSON.stringify(doc1[key]) !== JSON.stringify(doc2[key])) {
        return true;
      }
    }
    
    for (const key in doc2) {
      if (ignoreFields.includes(key)) continue;
      
      if (!(key in doc1)) {
        return true;
      }
    }
    
    return false;
  }

  arraysEqual(arr1, arr2) {
    if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
      return arr1 === arr2;
    }
    
    if (arr1.length !== arr2.length) {
      return false;
    }
    
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    
    return sorted1.every((val, index) => val === sorted2[index]);
  }

  async resolveConflict(documentId, winningRev, losingRevs = []) {
    try {
      // Get the winning document
      const winningDoc = await this.db.get(documentId, { rev: winningRev });
      
      // Delete the losing revisions
      const deletePromises = losingRevs.map(async (rev) => {
        try {
          await this.db.destroy(documentId, rev);
          console.log(`Deleted conflicting revision ${rev} for document ${documentId}`);
        } catch (error) {
          console.warn(`Could not delete conflicting revision ${rev}: ${error.message}`);
        }
      });
      
      await Promise.allSettled(deletePromises);
      
      // Update the winning document to record the resolution
      winningDoc.conflictResolution = {
        resolvedAt: new Date().toISOString(),
        resolvedBy: process.env.INSTANCE_ID || 'unknown',
        winningRev: winningRev,
        deletedRevs: losingRevs
      };
      
      await this.db.insert(winningDoc);
      
      console.log(`Resolved conflict for document ${documentId}`);
      return true;
      
    } catch (error) {
      console.error(`Error resolving conflict for document ${documentId}:`, error);
      throw error;
    }
  }

  async getConflictStats() {
    try {
      const allConflicts = await this.getAllConflicts();
      
      const stats = {
        total: allConflicts.length,
        byType: {},
        byInstance: {},
        requiresManualResolution: 0
      };
      
      for (const conflict of allConflicts) {
        // Count by document type
        stats.byType[conflict.documentType] = (stats.byType[conflict.documentType] || 0) + 1;
        
        // Count by instances involved
        for (const instance of conflict.analysis.instancesInvolved || []) {
          stats.byInstance[instance] = (stats.byInstance[instance] || 0) + 1;
        }
        
        // Count manual resolution needed
        if (conflict.analysis.requiresManualResolution) {
          stats.requiresManualResolution++;
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Error getting conflict stats:', error);
      return { total: 0, byType: {}, byInstance: {}, requiresManualResolution: 0 };
    }
  }
}

module.exports = ConflictDetector;