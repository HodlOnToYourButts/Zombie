const nano = require('nano');

class Database {
  constructor() {
    const username = process.env.COUCHDB_USER || 'admin';
    const password = process.env.COUCHDB_PASSWORD || 'password';
    
    // Primary CouchDB URL for this instance
    const primaryUrl = process.env.PRIMARY_COUCHDB_URL || 'http://localhost:5984';
    this.primaryCouchUrl = primaryUrl.replace('://', `://${username}:${password}@`);
    
    // Peer CouchDB URLs for replication
    const peerUrls = process.env.PEER_COUCHDB_URLS || '';
    this.peerCouchUrls = peerUrls.split(',')
      .filter(url => url.trim())
      .map(url => url.trim().replace('://', `://${username}:${password}@`));
    
    this.dbName = process.env.COUCHDB_DATABASE || 'zombieauth';
    this.instanceId = process.env.INSTANCE_ID || 'default';
    this.instanceLocation = process.env.INSTANCE_LOCATION || 'unknown';
    
    // Use primary CouchDB for main operations
    this.client = nano(this.primaryCouchUrl);
    this.db = null;
    
    // Track replication status
    this.replicationManager = null;
  }

  async initialize() {
    try {
      // Wait for CouchDB to be ready
      await this.waitForCouchDB();
      
      // Try to access the database, create if it doesn't exist
      try {
        this.db = this.client.db.use(this.dbName);
        await this.db.info(); // Test if database exists and is accessible
      } catch (error) {
        if (error.statusCode === 404) {
          console.log(`Creating database: ${this.dbName}`);
          await this.client.db.create(this.dbName);
          this.db = this.client.db.use(this.dbName);
        } else {
          throw error;
        }
      }
      
      // Create design documents for views
      await this.createViews();
      
      // Note: Using single-node CouchDB instances now
      // Cluster replication handled by CouchDB itself
      
      // Create default OIDC clients
      await this.createDefaultClients();
      
      // Create default admin user
      await this.createDefaultAdminUser();
      
      console.log(`Connected to CouchDB database: ${this.dbName} (Instance: ${this.instanceId})`);
      return true;
    } catch (error) {
      console.error('Failed to initialize database:', error.message);
      throw error;
    }
  }

  async waitForCouchDB() {
    const maxRetries = 30;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        // Test connection by checking if we can access the server info
        await this.client.info();
        console.log('CouchDB connection established with authentication');
        return;
      } catch (error) {
        console.log(`Waiting for CouchDB... (${retries + 1}/${maxRetries}) - Error: ${error.message}`);
        
        // If it's an authentication error, try to connect without auth to see if CouchDB is up
        if (error.statusCode === 401 && retries % 5 === 0) {
          try {
            const primaryUrl = process.env.PRIMARY_COUCHDB_URL || 'http://localhost:5984';
            const noAuthClient = nano(primaryUrl);
            await noAuthClient.info();
            console.log('CouchDB is running but authentication failed - database user may not exist yet');
          } catch (noAuthError) {
            console.log('CouchDB appears to be unreachable');
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries++;
      }
    }
    
    throw new Error('CouchDB not available after maximum retries');
  }


  async createViews() {
    const designDocs = [
      {
        _id: '_design/users',
        views: {
          by_email: {
            map: function(doc) {
              if (doc.type === 'user' && doc.email) {
                emit(doc.email, doc);
              }
            }.toString()
          },
          by_username: {
            map: function(doc) {
              if (doc.type === 'user' && doc.username) {
                emit(doc.username, doc);
              }
            }.toString()
          }
        }
      },
      {
        _id: '_design/sessions',
        views: {
          by_user_id: {
            map: function(doc) {
              if (doc.type === 'session' && doc.userId) {
                emit(doc.userId, doc);
              }
            }.toString()
          },
          by_auth_code: {
            map: function(doc) {
              if (doc.type === 'session' && doc.authorizationCode) {
                emit(doc.authorizationCode, doc);
              }
            }.toString()
          },
          active_sessions: {
            map: function(doc) {
              if (doc.type === 'session' && doc.active) {
                emit(doc.userId, doc);
              }
            }.toString()
          }
        }
      },
      {
        _id: '_design/activities',
        views: {
          by_timestamp: {
            map: function(doc) {
              if (doc.type === 'activity' && doc.timestamp) {
                emit(doc.timestamp, doc);
              }
            }.toString()
          }
        }
      },
      {
        _id: '_design/clients',
        views: {
          by_client_id: {
            map: function(doc) {
              if (doc.type === 'client' && doc.clientId) {
                emit(doc.clientId, doc);
              }
            }.toString()
          },
          by_name: {
            map: function(doc) {
              if (doc.type === 'client' && doc.name) {
                emit(doc.name, doc);
              }
            }.toString()
          },
          enabled_clients: {
            map: function(doc) {
              if (doc.type === 'client' && doc.enabled) {
                emit(doc.name, doc);
              }
            }.toString()
          }
        }
      }
    ];

    for (const designDoc of designDocs) {
      try {
        await this.db.insert(designDoc);
      } catch (error) {
        if (error.statusCode !== 409) { // 409 = conflict (already exists)
          console.error(`Failed to create design document ${designDoc._id}:`, error.message);
        }
      }
    }
  }

  async testConnection() {
    try {
      const info = await this.client.db.get(this.dbName);
      return {
        connected: true,
        database: info.db_name,
        doc_count: info.doc_count
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  async createDefaultClients() {
    console.log('Creating default OIDC clients...');
    
    const { ADMIN_CLIENT_CONFIG } = require('./config/oidc-client');
    const Client = require('./models/Client');
    
    try {
      // Require DEFAULT_CLIENT_ID to be set for security
      const sharedClientId = process.env.DEFAULT_CLIENT_ID;
      if (!sharedClientId) {
        throw new Error('DEFAULT_CLIENT_ID environment variable must be set for security. Generate with: openssl rand -hex 16');
      }
      
      // Validate client ID format - should match auto-generated client IDs
      if (!sharedClientId.startsWith('client_') || sharedClientId.length !== 39) {
        throw new Error('DEFAULT_CLIENT_ID must follow format "client_<32_hex_chars>" to match auto-generated client IDs. Generate with: openssl rand -hex 16');
      }
      
      // All possible redirect URIs for all instances (admin servers on ports 4000+)
      const allRedirectUris = [
        'http://localhost:4000/callback',  // Node1 admin
        'http://localhost:4001/callback',  // Node2 admin  
        'http://localhost:4002/callback'   // Node3 admin
      ];
      
      // Check if shared client already exists
      const existingClient = await Client.findByClientId(sharedClientId);
      
      if (!existingClient) {
        console.log(`Creating shared OIDC client: ${sharedClientId}`);
        
        const sharedClient = new Client({
          clientId: sharedClientId,
          clientSecret: ADMIN_CLIENT_CONFIG.client_secret,
          name: 'ZombieAuth - Multi-Instance',
          description: 'Shared OIDC client for all ZombieAuth instances',
          redirectUris: allRedirectUris,
          scopes: ADMIN_CLIENT_CONFIG.scope.split(' '),
          grantTypes: ['authorization_code', 'refresh_token'],
          responseTypes: ['code'],
          confidential: true,
          enabled: true
        });
        
        await sharedClient.save();
        console.log(`Shared OIDC client created successfully: ${sharedClientId}`);
      } else {
        // Update existing client with new redirect URIs if they've changed
        const currentUris = existingClient.redirectUris || [];
        const newUris = allRedirectUris;
        
        if (JSON.stringify(currentUris.sort()) !== JSON.stringify(newUris.sort())) {
          console.log(`Updating redirect URIs for existing client: ${sharedClientId}`);
          existingClient.redirectUris = newUris;
          await existingClient.save();
          console.log(`Client redirect URIs updated successfully`);
        } else {
          console.log(`Shared OIDC client already exists: ${sharedClientId}`);
        }
      }
    } catch (error) {
      if (error.statusCode === 409) {
        // Conflict error - another instance created the client first
        console.log('Shared OIDC client created by another instance');
      } else {
        console.error('Error creating default clients:', error);
      }
      // Don't throw error - allow system to continue even if client creation fails
    }
  }

  async initializeReplication() {
    if (this.peerCouchUrls.length === 0) {
      console.log('No peer CouchDB URLs configured - running in standalone mode');
      return;
    }

    console.log(`Setting up replication with ${this.peerCouchUrls.length} peer(s)...`);
    
    // Get the replicator database
    const replicator = this.client.db.use('_replicator');
    
    for (let i = 0; i < this.peerCouchUrls.length; i++) {
      const peerUrl = this.peerCouchUrls[i];
      const peerDbUrl = `${peerUrl}/${this.dbName}`;
      
      try {
        // Create bidirectional replication for each peer
        await this.setupBidirectionalReplication(replicator, peerDbUrl, i + 1);
      } catch (error) {
        console.warn(`Failed to setup replication with peer ${i + 1}: ${error.message}`);
      }
    }
  }

  async setupBidirectionalReplication(replicator, peerDbUrl, peerIndex) {
    const pushReplicationId = `push-${this.instanceId}-to-peer${peerIndex}`;
    const pullReplicationId = `pull-peer${peerIndex}-to-${this.instanceId}`;
    
    // Setup push replication (local -> peer)
    await this.createReplicationDoc(replicator, {
      _id: pushReplicationId,
      source: this.dbName,
      target: peerDbUrl,
      continuous: true,
      create_target: true,
      owner: `${this.instanceId}-system`
    });
    
    // Setup pull replication (peer -> local)  
    await this.createReplicationDoc(replicator, {
      _id: pullReplicationId,
      source: peerDbUrl,
      target: this.dbName,
      continuous: true,
      create_target: false,
      owner: `${this.instanceId}-system`
    });
    
    console.log(`Bidirectional replication setup with peer ${peerIndex}`);
  }

  async createReplicationDoc(replicator, replicationDoc) {
    try {
      // Check if replication already exists
      try {
        const existing = await replicator.get(replicationDoc._id);
        // If it exists and is running, leave it alone
        if (existing._replication_state === 'triggered' || existing._replication_state === 'running') {
          console.log(`Replication ${replicationDoc._id} already running`);
          return existing;
        }
        // If it exists but is not running, update it
        replicationDoc._rev = existing._rev;
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }
      
      // Create or update the replication
      const result = await replicator.insert(replicationDoc);
      console.log(`Created/updated replication: ${replicationDoc._id}`);
      return result;
      
    } catch (error) {
      console.error(`Error creating replication ${replicationDoc._id}:`, error.message);
      throw error;
    }
  }

  async getReplicationStatus() {
    try {
      const replicator = this.client.db.use('_replicator');
      const result = await replicator.list({ include_docs: true });
      
      const replications = result.rows
        .filter(row => row.doc.owner === `${this.instanceId}-system`)
        .map(row => ({
          id: row.doc._id,
          state: row.doc._replication_state,
          stateReason: row.doc._replication_state_reason,
          stateTime: row.doc._replication_state_time,
          source: row.doc.source,
          target: row.doc.target,
          continuous: row.doc.continuous,
          docsRead: row.doc.docs_read || 0,
          docsWritten: row.doc.docs_written || 0
        }));
      
      return replications;
    } catch (error) {
      console.error('Error getting replication status:', error);
      return [];
    }
  }

  async createDefaultAdminUser() {
    console.log('Creating default admin user...');
    
    const User = require('./models/User');
    
    try {
      // Get admin credentials from environment variables
      const adminUsername = process.env.ADMIN_USERNAME;
      const adminPassword = process.env.ADMIN_PASSWORD;
      
      if (!adminUsername || !adminPassword) {
        throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD environment variables must be set');
      }
      
      // Check if admin user already exists
      const existingAdmin = await User.findByUsername(adminUsername);
      
      if (!existingAdmin) {
        console.log(`Creating admin user: ${adminUsername}`);
        
        const passwordHash = await User.hashPassword(adminPassword);
        const adminUser = new User({
          username: adminUsername,
          email: process.env.ADMIN_EMAIL || `${adminUsername}@zombieauth.local`,
          passwordHash: passwordHash,
          firstName: 'System',
          lastName: 'Administrator',
          groups: ['admin'],
          roles: ['admin', 'user'],
          enabled: true,
          emailVerified: true
        });
        
        await adminUser.save();
        console.log('Admin user created successfully');
        console.log(`Login credentials: username=${adminUsername}`);
      } else {
        console.log(`Admin user ${adminUsername} already exists`);
      }
    } catch (error) {
      console.error('Error creating default admin user:', error);
      throw error; // This is critical - don't continue without admin user
    }
  }

  getInstanceInfo() {
    return {
      instanceId: this.instanceId,
      location: this.instanceLocation,
      primaryCouchUrl: this.primaryCouchUrl.replace(/\/\/[^@]+@/, '//***:***@'), // Hide credentials
      peerCount: this.peerCouchUrls.length
    };
  }

  getDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }
}

module.exports = new Database();