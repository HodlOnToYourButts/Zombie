const express = require('express');
const User = require('../models/User');
const Session = require('../models/Session');
const Activity = require('../models/Activity');
const Client = require('../models/Client');
const database = require('../database');
const oidcAuth = require('../middleware/oidc-auth');
const { getClientIp } = require('../utils/ip-helper');
const ConflictDetector = require('../services/conflict-detector');
const ClusterHealth = require('../services/cluster-health');

const router = express.Router();

// User API endpoints
router.post('/users/:id/toggle', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.id);
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }
    
    // Don't allow disabling yourself
    if (req.oidc_user && user.username === req.oidc_user.username && !req.body.enabled) {
      return res.json({ success: false, error: 'Cannot disable yourself' });
    }
    
    user.enabled = req.body.enabled;
    await user.save();
    
    // Log activity
    await Activity.logActivity(req.body.enabled ? 'user_enabled' : 'user_disabled', {
      targetUsername: user.username,
      targetUserId: user._id,
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Toggle user error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.delete('/users/:id', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.id);
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }
    
    // Don't allow deleting yourself
    if (req.oidc_user && user.username === req.oidc_user.username) {
      return res.json({ success: false, error: 'Cannot delete yourself' });
    }
    
    // Log activity before deletion
    await Activity.logActivity('user_deleted', {
      targetUsername: user.username,
      targetUserId: user._id,
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });
    
    await user.delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/users/:id/password', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.id);
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }
    
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    user.passwordHash = await User.hashPassword(password);
    await user.save();
    
    // Log activity
    await Activity.logActivity('password_reset', {
      targetUsername: user.username,
      targetUserId: user._id,
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/users/:id/sessions', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.id);
    const sessions = await Session.findByUserId(userId);
    
    const sessionsWithStatus = sessions.map(session => ({
      ...session.toPublicJSON(),
      isExpired: session.isExpired()
    }));
    
    res.json({ success: true, sessions: sessionsWithStatus });
  } catch (error) {
    console.error('Get user sessions error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/users/:id/sessions/invalidate', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.id);
    const sessions = await Session.findByUserId(userId);
    
    let count = 0;
    for (const session of sessions) {
      if (session.active) {
        await session.invalidate();
        count++;
      }
    }
    
    res.json({ success: true, count });
  } catch (error) {
    console.error('Invalidate user sessions error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Session API endpoints
router.get('/sessions/:id', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.json({ success: false, error: 'Session not found' });
    }
    
    const user = await User.findById(session.userId);
    
    const sessionData = {
      ...session.toPublicJSON(),
      user: user ? user.toPublicJSON() : { username: 'Unknown', email: 'Unknown' },
      isExpired: session.isExpired(),
      accessToken: !!session.accessToken,
      refreshToken: !!session.refreshToken,
      idToken: !!session.idToken
    };
    
    res.json({ success: true, session: sessionData });
  } catch (error) {
    console.error('Get session error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/invalidate', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.json({ success: false, error: 'Session not found' });
    }
    
    await session.invalidate();
    
    // Log activity
    await Activity.logActivity('session_invalidated', {
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      details: `Session ${req.params.id} invalidated`
    });
    
    // Destroy the user's Express session if they have one
    const sessionManager = require('../utils/session-manager');
    const sessionDestroyed = await sessionManager.destroyUserSession(session.userId);
    
    res.json({ 
      success: true, 
      sessionDestroyed
    });
  } catch (error) {
    console.error('Invalidate session error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.delete('/sessions/:id', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.json({ success: false, error: 'Session not found' });
    }
    
    await session.delete();
    
    // Destroy the user's Express session if they have one
    const sessionManager = require('../utils/session-manager');
    const sessionDestroyed = await sessionManager.destroyUserSession(session.userId);
    
    res.json({ 
      success: true, 
      sessionDestroyed
    });
  } catch (error) {
    console.error('Delete session error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/sessions/clear-inactive', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const db = database.getDb();
    const result = await db.view('sessions', 'by_user_id', { include_docs: true });
    
    let count = 0;
    for (const row of result.rows) {
      const session = new Session(row.doc);
      if (!session.active || session.isExpired()) {
        await session.delete();
        count++;
      }
    }
    
    res.json({ success: true, count });
  } catch (error) {
    console.error('Clear inactive sessions error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/sessions/clear-all', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const db = database.getDb();
    const result = await db.view('sessions', 'by_user_id', { include_docs: true });
    
    let count = 0;
    for (const row of result.rows) {
      const session = new Session(row.doc);
      await session.delete();
      count++;
    }
    
    // Clear the current admin session as well to force re-authentication
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying admin session:', err);
        return res.json({ success: false, error: 'Failed to clear admin session' });
      }
      
      res.json({ 
        success: true, 
        count, 
        adminSessionCleared: true,
        message: 'All sessions cleared. Admin will need to re-authenticate.' 
      });
    });
    
  } catch (error) {
    console.error('Clear all sessions error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Client API endpoints
router.post('/clients/:id/toggle', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const clientId = decodeURIComponent(req.params.id);
    const client = await Client.findById(clientId);
    if (!client) {
      return res.json({ success: false, error: 'Client not found' });
    }
    
    // Don't allow disabling the default admin client
    if (client.clientId === 'zombieauth' && !req.body.enabled) {
      return res.json({ success: false, error: 'Cannot disable the default client' });
    }
    
    client.enabled = req.body.enabled;
    await client.save();
    
    // Log activity
    await Activity.logActivity(req.body.enabled ? 'client_enabled' : 'client_disabled', {
      targetUsername: client.name,
      targetUserId: client._id,
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Toggle client error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/clients/:id/regenerate-secret', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const clientId = decodeURIComponent(req.params.id);
    const client = await Client.findById(clientId);
    if (!client) {
      return res.json({ success: false, error: 'Client not found' });
    }
    
    // Generate new secret
    const newSecret = client.generateClientSecret();
    client.clientSecret = newSecret;
    await client.save();
    
    // Log activity
    await Activity.logActivity('client_secret_regenerated', {
      targetUsername: client.name,
      targetUserId: client._id,
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });
    
    res.json({ success: true, clientSecret: newSecret });
  } catch (error) {
    console.error('Regenerate client secret error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.delete('/clients/:id', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const clientId = decodeURIComponent(req.params.id);
    const client = await Client.findById(clientId);
    if (!client) {
      return res.json({ success: false, error: 'Client not found' });
    }
    
    // Don't allow deleting the default admin client
    if (client.clientId === 'zombieauth') {
      return res.json({ success: false, error: 'Cannot delete the default client' });
    }
    
    // Log activity before deletion
    await Activity.logActivity('client_deleted', {
      targetUsername: client.name,
      targetUserId: client._id,
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });
    
    await client.delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete client error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Initialize conflict detector and cluster health monitor
const conflictDetector = new ConflictDetector();
const clusterHealth = new ClusterHealth();

// Conflict Resolution API endpoints
router.get('/conflicts', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    await conflictDetector.initialize();
    const conflicts = await conflictDetector.getAllConflicts();
    res.json({ success: true, conflicts });
  } catch (error) {
    console.error('Get conflicts error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/conflicts/users', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    await conflictDetector.initialize();
    const userConflicts = await conflictDetector.getUserConflicts();
    res.json({ success: true, conflicts: userConflicts });
  } catch (error) {
    console.error('Get user conflicts error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/conflicts/stats', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    await conflictDetector.initialize();
    const stats = await conflictDetector.getConflictStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get conflict stats error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/conflicts/:docId/resolve', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    await conflictDetector.initialize();
    
    const { docId } = req.params;
    const { winningRev, losingRevs, mergeData } = req.body;
    
    if (mergeData) {
      // Handle merge resolution
      const db = database.getDb();
      const currentDoc = await db.get(docId);
      
      // Apply merged data
      Object.assign(currentDoc, mergeData);
      
      // Update instance metadata
      currentDoc.instanceMetadata = {
        ...currentDoc.instanceMetadata,
        lastModifiedBy: process.env.INSTANCE_ID || 'unknown',
        lastModifiedAt: new Date().toISOString(),
        version: (currentDoc.instanceMetadata?.version || 1) + 1
      };
      
      // Add conflict resolution metadata
      currentDoc.conflictResolution = {
        resolvedAt: new Date().toISOString(),
        resolvedBy: req.oidc_user?.username || 'admin',
        resolvedVia: 'merge',
        mergedData: mergeData
      };
      
      await db.insert(currentDoc);
      
      // Clean up conflicting revisions
      if (losingRevs && losingRevs.length > 0) {
        await conflictDetector.resolveConflict(docId, currentDoc._rev, losingRevs);
      }
    } else if (winningRev && losingRevs) {
      // Handle simple resolution by choosing winning revision
      await conflictDetector.resolveConflict(docId, winningRev, losingRevs);
    } else {
      return res.json({ success: false, error: 'Either winningRev/losingRevs or mergeData must be provided' });
    }
    
    // Log activity
    await Activity.logActivity('conflict_resolved', {
      adminUserId: req.oidc_user?.sub,
      adminUsername: req.oidc_user?.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      details: `Resolved conflict for document ${docId}`
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Resolve conflict error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/replication/status', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    const replicationStatus = await database.getReplicationStatus();
    const instanceInfo = database.getInstanceInfo();
    
    res.json({ 
      success: true, 
      replication: replicationStatus,
      instance: instanceInfo
    });
  } catch (error) {
    console.error('Get replication status error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Cluster Health API endpoints
router.get('/cluster/health', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    await clusterHealth.initialize();
    const health = await clusterHealth.checkClusterHealth();
    res.json({ success: true, health });
  } catch (error) {
    console.error('Get cluster health error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/cluster/isolation-warning', oidcAuth.requireOidcAuth('admin'), async (req, res) => {
  try {
    await clusterHealth.initialize();
    await clusterHealth.checkClusterHealth(); // Refresh health status
    const warning = clusterHealth.getIsolationWarning();
    res.json({ success: true, warning });
  } catch (error) {
    console.error('Get isolation warning error:', error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;