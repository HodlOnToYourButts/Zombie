const nano = require('nano');

class DatabaseSetup {
  constructor() {
    this.couchUrl = process.env.COUCHDB_URL || 'http://localhost:5984';
    this.dbName = process.env.COUCHDB_DATABASE || 'zombie';
    this.appUser = process.env.COUCHDB_USER || 'zombie';
    this.appPassword = process.env.COUCHDB_PASSWORD;

    // Admin credentials for setup (only used for initial setup)
    this.adminUser = process.env.COUCHDB_USER;
    this.adminPassword = process.env.COUCHDB_PASSWORD;
  }

  async initializeDatabase() {
    if (!this.appPassword) {
      throw new Error('COUCHDB_PASSWORD environment variable must be set');
    }

    console.log('🚀 Initializing CouchDB database...');

    try {
      // First, wait for CouchDB to be available
      await this.waitForCouchDB();

      // Check if database already exists and is accessible
      if (await this.isDatabaseReady()) {
        console.log('✅ Database already exists and is accessible');
        return true;
      }

      // If not accessible, try to set it up with admin credentials
      console.log('📁 Setting up database with admin credentials...');
      await this.setupDatabase();

      // Set up application-specific database structure
      console.log('🧟 Setting up Zombie application database structure...');
      await this.setupApplicationStructure();

      console.log('✅ Database initialization completed successfully!');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize database:', error.message);

      if (error.statusCode === 401) {
        console.error('Authentication failed. Please ensure:');
        console.error('1. CouchDB admin credentials are correct (COUCHDB_ADMIN_USER/COUCHDB_ADMIN_PASSWORD)');
        console.error('2. Or run ./scripts/couchdb-setup.sh manually to set up the database');
      }

      throw error;
    }
  }

  async waitForCouchDB() {
    const maxRetries = 30;
    let retries = 0;

    console.log('⏳ Waiting for CouchDB to be available...');

    while (retries < maxRetries) {
      try {
        const client = nano(this.couchUrl);
        await client.info();
        console.log('✅ CouchDB is available');
        return;
      } catch (error) {
        console.log(`Waiting for CouchDB... (${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries++;
      }
    }

    throw new Error('CouchDB not available after maximum retries');
  }

  async isDatabaseReady() {
    try {
      // Try to connect with app credentials
      const appCouchUrl = this.couchUrl.replace('://', `://${this.appUser}:${this.appPassword}@`);
      const client = nano(appCouchUrl);
      const db = client.db.use(this.dbName);

      await db.info();
      return true;
    } catch (error) {
      return false;
    }
  }

  async setupDatabase() {
    // Use admin credentials for setup
    const adminCouchUrl = this.couchUrl.replace('://', `://${this.adminUser}:${this.adminPassword}@`);
    const adminClient = nano(adminCouchUrl);

    // Test admin connection
    try {
      await adminClient.info();
    } catch (error) {
      throw new Error(`Failed to connect with admin credentials: ${error.message}`);
    }

    // Create database
    console.log(`📁 Creating database: ${this.dbName}`);
    try {
      await adminClient.db.create(this.dbName);
      console.log('✅ Database created successfully');
    } catch (error) {
      if (error.statusCode === 412) {
        console.log('ℹ️  Database already exists');
      } else {
        throw new Error(`Failed to create database: ${error.message}`);
      }
    }

    // Create database user
    console.log(`👤 Creating database user: ${this.appUser}`);
    const userDoc = {
      _id: `org.couchdb.user:${this.appUser}`,
      name: this.appUser,
      type: 'user',
      roles: [],
      password: this.appPassword
    };

    try {
      const usersDb = adminClient.db.use('_users');
      await usersDb.insert(userDoc);
      console.log('✅ Database user created successfully');
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Database user already exists');
      } else {
        throw new Error(`Failed to create database user: ${error.message}`);
      }
    }

    // Set database permissions
    console.log('🔐 Setting database permissions...');
    const securityDoc = {
      members: {
        names: [this.appUser],
        roles: []
      }
    };

    try {
      const db = adminClient.db.use(this.dbName);
      await db.insert(securityDoc, '_security');
      console.log('✅ Database permissions set successfully');
    } catch (error) {
      throw new Error(`Failed to set database permissions: ${error.message}`);
    }
  }

  async setupApplicationStructure() {
    // Use app credentials for application setup
    const appCouchUrl = this.couchUrl.replace('://', `://${this.appUser}:${this.appPassword}@`);
    const client = nano(appCouchUrl);
    const db = client.db.use(this.dbName);

    // Create design documents for views and indexes
    console.log('📋 Creating design documents...');

    await this.createUsersDesignDoc(db);
    await this.createSessionsDesignDoc(db);
    await this.createClientsDesignDoc(db);
    await this.createAuthCodesDesignDoc(db);
    await this.createRefreshTokensDesignDoc(db);
    await this.createInstancesDesignDoc(db);

    // Create indexes for better query performance
    console.log('📊 Creating database indexes...');
    await this.createDatabaseIndexes(db);

    // Create application metadata document
    console.log('🏠 Creating application metadata document...');
    await this.createApplicationMetadata(db);
  }

  async createUsersDesignDoc(db) {
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
      await db.insert(usersDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Users design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createSessionsDesignDoc(db) {
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
      await db.insert(sessionsDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Sessions design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createClientsDesignDoc(db) {
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
      await db.insert(clientsDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Clients design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createAuthCodesDesignDoc(db) {
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
      await db.insert(authCodesDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Authorization codes design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createRefreshTokensDesignDoc(db) {
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
      await db.insert(refreshTokensDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Refresh tokens design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createInstancesDesignDoc(db) {
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
      await db.insert(instanceDesignDoc);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Instance metadata design document may already exist');
      } else {
        throw error;
      }
    }
  }

  async createDatabaseIndexes(db) {
    // Index for user lookups
    const userIndex = {
      index: {
        fields: ['type', 'username']
      },
      name: 'user-username-index',
      type: 'json'
    };

    try {
      await db.createIndex(userIndex);
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
      await db.createIndex(sessionIndex);
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
      await db.createIndex(clientIndex);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Client index may already exist');
      } else {
        throw error;
      }
    }
  }

  async createApplicationMetadata(db) {
    const appMetadata = {
      _id: 'app:metadata',
      type: 'app_metadata',
      version: '0.1.0',
      name: 'zombie',
      description: 'Still authenticating when everything else is dead.',
      setup_date: new Date().toISOString(),
      instance_id: process.env.INSTANCE_ID || 'default'
    };

    try {
      await db.insert(appMetadata);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log('ℹ️  Application metadata may already exist');
      } else {
        throw error;
      }
    }
  }
}

module.exports = DatabaseSetup;