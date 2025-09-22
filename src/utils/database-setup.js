const nano = require('nano');

class DatabaseSetup {
  constructor() {
    this.couchUrl = process.env.COUCHDB_URL || 'http://localhost:5984';
    this.dbName = process.env.COUCHDB_DATABASE || 'zombieauth';
    this.appUser = process.env.COUCHDB_USER || 'zombieauth';
    this.appPassword = process.env.COUCHDB_PASSWORD;

    // Admin credentials for setup (only used for initial setup)
    this.adminUser = process.env.COUCHDB_ZOMBIEAUTH_USER || 'zombieauth';
    this.adminPassword = process.env.COUCHDB_ZOMBIEAUTH_PASSWORD || 'zombieauth';
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

      console.log('✅ Database initialization completed successfully!');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize database:', error.message);

      if (error.statusCode === 401) {
        console.error('Authentication failed. Please ensure:');
        console.error('1. CouchDB admin credentials are correct (COUCHDB_ADMIN_USER/COUCHDB_ADMIN_PASSWORD)');
        console.error('2. Or run ./setup-couchdb.sh manually to set up the database');
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
}

module.exports = DatabaseSetup;