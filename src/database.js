const nano = require('nano');

class Database {
  constructor() {
    const username = process.env.COUCHDB_USER || 'zombie';
    const password = process.env.COUCHDB_PASSWORD;

    if (!password) {
      throw new Error('COUCHDB_PASSWORD environment variable must be set');
    }
    
    // Primary CouchDB URL for this instance
    const primaryUrl = process.env.COUCHDB_URL || 'http://localhost:5984';
    this.primaryCouchUrl = primaryUrl.replace('://', `://${username}:${password}@`);
    
    // Peer CouchDB URLs for replication
    const peerUrls = process.env.PEER_COUCHDB_URLS || '';
    this.peerCouchUrls = peerUrls.split(',')
      .filter(url => url.trim())
      .map(url => url.trim().replace('://', `://${username}:${password}@`));
    
    this.dbName = process.env.COUCHDB_DATABASE || 'zombie';
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

      // Connect to the database (should be set up by couchdb-setup container)
      this.db = this.client.db.use(this.dbName);
      await this.db.info(); // Test if database exists and is accessible

      console.log(`Connected to CouchDB database: ${this.dbName} (Instance: ${this.instanceId})`);
      return true;
    } catch (error) {
      console.error('Failed to initialize database:', error.message);
      if (error.statusCode === 404) {
        console.error('Database not found. Please ensure couchdb-setup container ran successfully.');
      } else if (error.statusCode === 401) {
        console.error('Authentication failed. Please check COUCHDB_USER and COUCHDB_PASSWORD environment variables.');
      }
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
        
        // If it's an authentication error, provide helpful message
        if (error.statusCode === 401 && retries % 5 === 0) {
          console.log('Authentication failed - please ensure database user exists and credentials are correct');
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries++;
      }
    }
    
    throw new Error('CouchDB not available after maximum retries');
  }


  async testConnection() {
    try {
      const info = await this.db.info();
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

  // Database setup methods (merged from database-setup.js)
  async initializeDatabaseStructure() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    console.log('🧟 Setting up Zombie application database structure...');

    try {
      // Create design documents for views and indexes
      console.log('📋 Creating design documents...');

      await this.createUsersDesignDoc();
      await this.createSessionsDesignDoc();
      await this.createClientsDesignDoc();
      await this.createAuthCodesDesignDoc();
      await this.createRefreshTokensDesignDoc();
      await this.createInstancesDesignDoc();

      // Create indexes for better query performance
      console.log('📊 Creating database indexes...');
      await this.createDatabaseIndexes();

      // Create application metadata document
      console.log('🏠 Creating application metadata document...');
      await this.createApplicationMetadata();

      console.log('✅ Database structure setup completed successfully!');
      return true;
    } catch (error) {
      console.error('❌ Failed to setup database structure:', error.message);
      throw error;
    }
  }

  async createUsersDesignDoc() {
    console.log('👥 Creating users design document...');
    const usersDesignDoc = {
      _id: '_design/users',
      views: {
        by_username: {
          map: 'function(doc) { if (doc.type === "user" && doc.username) { emit(doc.username, doc); } }'
        },
        by_email: {
          map: 'function(doc) { if (doc.type === "user" && doc.email) { emit(doc.email, doc); } }'
        },
        by_role: {
          map: 'function(doc) { if (doc.type === "user" && doc.roles) { doc.roles.forEach(function(role) { emit(role, doc); }); } }'
        }
      }
    };

    try {
      await this.db.insert(usersDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Users design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createSessionsDesignDoc() {
    console.log('🎫 Creating sessions design document...');
    const sessionsDesignDoc = {
      _id: '_design/sessions',
      views: {
        by_user: {
          map: 'function(doc) { if (doc.type === "session" && doc.user_id) { emit(doc.user_id, doc); } }'
        },
        by_user_id: {
          map: 'function(doc) { if (doc.type === "session" && doc.user_id) { emit(doc.user_id, doc); } }'
        },
        by_expiry: {
          map: 'function(doc) { if (doc.type === "session" && doc.expires_at) { emit(doc.expires_at, doc); } }'
        },
        by_auth_code: {
          map: 'function(doc) { if (doc.type === "session" && doc.authorization_code) { emit(doc.authorization_code, doc); } }'
        },
        active: {
          map: 'function(doc) { if (doc.type === "session" && doc.expires_at && new Date(doc.expires_at) > new Date()) { emit(doc._id, doc); } }'
        }
      }
    };

    try {
      await this.db.insert(sessionsDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Sessions design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createClientsDesignDoc() {
    console.log('🔧 Creating clients design document...');
    const clientsDesignDoc = {
      _id: '_design/clients',
      views: {
        by_client_id: {
          map: 'function(doc) { if (doc.type === "client" && doc.client_id) { emit(doc.client_id, doc); } }'
        },
        by_type: {
          map: 'function(doc) { if (doc.type === "client" && doc.grant_types) { doc.grant_types.forEach(function(type) { emit(type, doc); }); } }'
        }
      }
    };

    try {
      await this.db.insert(clientsDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Clients design document exists, checking if update needed...');
        try {
          // Get existing design document
          const existing = await this.db.get('_design/clients');
          // Check if it has the old camelCase fields
          const hasOldStructure = existing.views?.by_client_id?.map?.includes('doc.clientId');

          if (hasOldStructure) {
            console.log('🔄 Updating clients design document to use snake_case fields...');
            clientsDesignDoc._rev = existing._rev;
            await this.db.insert(clientsDesignDoc);
            console.log('✅ Clients design document updated successfully');
          }
        } catch (updateError) {
          console.log('ℹ️  Could not check/update existing clients design document:', updateError.message);
        }
      } else {
        throw error;
      }
    }
  }

  async createAuthCodesDesignDoc() {
    console.log('🎟️ Creating authorization codes design document...');
    const authCodesDesignDoc = {
      _id: '_design/auth_codes',
      views: {
        by_code: {
          map: 'function(doc) { if (doc.type === "auth_code" && doc.code) { emit(doc.code, doc); } }'
        },
        by_client: {
          map: 'function(doc) { if (doc.type === "auth_code" && doc.client_id) { emit(doc.client_id, doc); } }'
        },
        by_expiry: {
          map: 'function(doc) { if (doc.type === "auth_code" && doc.expires_at) { emit(doc.expires_at, doc); } }'
        }
      }
    };

    try {
      await this.db.insert(authCodesDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Authorization codes design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createRefreshTokensDesignDoc() {
    console.log('🔄 Creating refresh tokens design document...');
    const refreshTokensDesignDoc = {
      _id: '_design/refresh_tokens',
      views: {
        by_token: {
          map: 'function(doc) { if (doc.type === "refresh_token" && doc.token) { emit(doc.token, doc); } }'
        },
        by_user: {
          map: 'function(doc) { if (doc.type === "refresh_token" && doc.user_id) { emit(doc.user_id, doc); } }'
        },
        by_client: {
          map: 'function(doc) { if (doc.type === "refresh_token" && doc.client_id) { emit(doc.client_id, doc); } }'
        }
      }
    };

    try {
      await this.db.insert(refreshTokensDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Refresh tokens design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createInstancesDesignDoc() {
    console.log('🌐 Creating instance metadata design document...');
    const instanceDesignDoc = {
      _id: '_design/instances',
      views: {
        by_instance_id: {
          map: 'function(doc) { if (doc.instance_id) { emit(doc.instance_id, doc); } }'
        },
        conflicts: {
          map: 'function(doc) { if (doc._conflicts) { emit(doc._id, doc); } }'
        },
        by_modified: {
          map: 'function(doc) { if (doc.modified_at) { emit(doc.modified_at, doc); } }'
        }
      }
    };

    try {
      await this.db.insert(instanceDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Instance metadata design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createDatabaseIndexes() {
    // Index for user lookups
    const userIndex = {
      index: {
        fields: ['type', 'username']
      },
      name: 'user-username-index',
      type: 'json'
    };

    try {
      await this.db.createIndex(userIndex);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  User username index may already exist');
      } else {
        throw error;
      }
    }

    // Index for session lookups
    const sessionIndex = {
      index: {
        fields: ['type', 'user_id', 'expires_at']
      },
      name: 'session-user-expiry-index',
      type: 'json'
    };

    try {
      await this.db.createIndex(sessionIndex);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Session index may already exist');
      } else {
        throw error;
      }
    }

    // Index for client lookups
    const clientIndex = {
      index: {
        fields: ['type', 'client_id']
      },
      name: 'client-id-index',
      type: 'json'
    };

    try {
      await this.db.createIndex(clientIndex);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Client index may already exist');
      } else {
        throw error;
      }
    }
  }

  async createApplicationMetadata() {
    const appMetadata = {
      _id: 'app:metadata',
      type: 'app_metadata',
      version: '0.1.0',
      name: 'zombie',
      description: 'Still authenticating when everything else is dead.',
      setup_date: new Date().toISOString(),
      instance_id: this.instanceId
    };

    try {
      await this.db.insert(appMetadata);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Application metadata may already exist');
      } else {
        throw error;
      }
    }
  }
}

module.exports = new Database();