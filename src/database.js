const nano = require('nano');

class Database {
  constructor() {
    const username = process.env.COUCHDB_USER || 'zombieauth';
    const password = process.env.COUCHDB_PASSWORD;
    
    if (!password) {
      throw new Error('COUCHDB_PASSWORD environment variable must be set');
    }
    
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
      
      // Connect to the database (should already exist from setup script)
      this.db = this.client.db.use(this.dbName);
      await this.db.info(); // Test if database exists and is accessible
      
      console.log(`Connected to CouchDB database: ${this.dbName} (Instance: ${this.instanceId})`);
      return true;
    } catch (error) {
      console.error('Failed to initialize database:', error.message);
      if (error.statusCode === 404) {
        console.error('Database not found. Please run ./setup-couchdb.sh first to create the database.');
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
}

module.exports = new Database();