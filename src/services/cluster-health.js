const database = require('../database');

// Global isolation state to persist across instances
global.clusterIsolationState = global.clusterIsolationState || {
  isolationStartTime: null,
  isolatedInstances: []
};

// Global cluster uptime state - tracks when all nodes are healthy
global.clusterUptimeState = global.clusterUptimeState || {
  fullySyncedSince: null // When cluster became fully synced (all_nodes == cluster_nodes)
};

class ClusterHealth {
  constructor() {
    this.instanceInfo = {};
    this.healthChecks = new Map();
    this.lastHealthCheck = null;
    this.database = null;
  }

  async initialize() {
    // Get known instances from environment or config
    this.knownInstances = this.getKnownInstances();
    
    // Initialize database connection
    this.database = require('../database');
  }

  getKnownInstances() {
    // Load cluster configuration from environment variables
    const clusterConfig = process.env.CLUSTER_INSTANCES;
    
    if (clusterConfig) {
      // Parse JSON configuration: [{"id":"dc1","name":"Datacenter 1","baseUrl":"http://...","statusUrl":"http://..."}]
      try {
        const instances = JSON.parse(clusterConfig);
        return instances.map((instance, index) => ({
          id: instance.id,
          name: instance.name,
          baseUrl: instance.baseUrl,
          statusUrl: instance.statusUrl, // URL to cluster status service
          priority: instance.priority || (index + 1)
        }));
      } catch (error) {
        console.error('Failed to parse CLUSTER_INSTANCES:', error);
        console.log('Using single-node configuration');
      }
    }
    
    // Fallback to single-node configuration for current instance
    const currentId = process.env.INSTANCE_ID || 'node1';
    const currentName = process.env.INSTANCE_NAME || `Node ${currentId}`;
    const currentUrl = process.env.INSTANCE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const statusUrl = process.env.CLUSTER_STATUS_URL || `http://localhost:${parseInt(process.env.PORT || 3000) + 100}`;
    
    return [{
      id: currentId,
      name: currentName,
      baseUrl: currentUrl,
      statusUrl: statusUrl,
      priority: 1
    }];
  }

  async checkClusterHealth() {
    const currentInstanceId = process.env.INSTANCE_ID || 'unknown';
    const healthResults = {
      timestamp: new Date().toISOString(),
      currentInstance: currentInstanceId,
      instances: [],
      summary: {
        total: this.knownInstances.length,
        healthy: 0,
        unhealthy: 0,
        isolated: []
      }
    };

    try {
      // Get database credentials from environment variables
      const dbUser = process.env.COUCHDB_USER || 'admin';
      const dbPassword = process.env.COUCHDB_PASSWORD || 'password';
      
      // Get the cluster status service URL for this instance
      const currentInstance = this.knownInstances.find(instance => instance.id === currentInstanceId);
      if (!currentInstance) {
        throw new Error(`Current instance ${currentInstanceId} not found in cluster configuration`);
      }
      
      const localStatusServiceUrl = currentInstance.statusUrl + '/cluster/membership';
      console.log('Cluster health check - currentInstanceId:', currentInstanceId);
      console.log('Using status service URL:', localStatusServiceUrl);
      
      console.log('Using cluster status service URL:', localStatusServiceUrl);

      // Query the cluster status service
      let membership;
      
      try {
        console.log('Querying cluster status service...');
        const membershipResponse = await this.makeHealthRequest(localStatusServiceUrl);
        
        if (!membershipResponse.ok) {
          console.error('Failed to get cluster status:', membershipResponse.status);
          throw new Error(`Cluster status service failed with status: ${membershipResponse.status}`);
        }
        
        const clusterStatus = await membershipResponse.json();
        console.log('Got cluster status from service:', clusterStatus);
        
        // Convert cluster status service response to membership format
        membership = {
          all_nodes: clusterStatus.nodes?.map(node => node.name) || [],
          cluster_nodes: clusterStatus.nodes?.filter(node => node.active).map(node => node.name) || []
        };
      } catch (serviceError) {
        console.log('Cluster status service failed:', serviceError.message);
        throw serviceError;
      }
      
      if (membership) {
        
        // Build dynamic node mapping from cluster configuration
        const nodeToInstance = {};
        const nodeMappingConfig = process.env.COUCHDB_NODE_MAPPING;
        
        if (nodeMappingConfig) {
          // Parse node mapping: {"couchdb@server1.domain":"instance1","couchdb@server2.domain":"instance2"}
          try {
            Object.assign(nodeToInstance, JSON.parse(nodeMappingConfig));
          } catch (error) {
            console.error('Failed to parse COUCHDB_NODE_MAPPING:', error);
          }
        } else {
          // Generate default mapping based on known instances
          this.knownInstances.forEach(instance => {
            // Default format: couchdb@{instanceId}.zombieauth
            const nodeName = `couchdb@${instance.id}.zombieauth`;
            nodeToInstance[nodeName] = instance.id;
          });
        }
        
        const activeNodes = membership.all_nodes || [];
        const clusterNodes = membership.cluster_nodes || [];
        
        // Track cluster uptime (when all_nodes matches cluster_nodes)
        const isFullySynced = activeNodes.length === clusterNodes.length && 
                             activeNodes.every(node => clusterNodes.includes(node));
        
        if (isFullySynced && !global.clusterUptimeState.fullySyncedSince) {
          // Cluster just became fully synced
          global.clusterUptimeState.fullySyncedSince = new Date();
          console.log('Cluster became fully synced at:', global.clusterUptimeState.fullySyncedSince.toISOString());
        } else if (!isFullySynced && global.clusterUptimeState.fullySyncedSince) {
          // Cluster lost full sync
          const uptimeDuration = new Date() - global.clusterUptimeState.fullySyncedSince;
          console.log('Cluster lost full sync after uptime of:', uptimeDuration, 'ms');
          global.clusterUptimeState.fullySyncedSince = null;
        }
        
        // Check each known instance based on CouchDB node membership
        for (const instance of this.knownInstances) {
          const correspondingNode = Object.keys(nodeToInstance).find(node => nodeToInstance[node] === instance.id);
          const isActive = activeNodes.includes(correspondingNode);
          
          const health = {
            id: instance.id,
            name: instance.name,
            baseUrl: instance.baseUrl,
            status: isActive ? 'healthy' : 'unreachable',
            responseTime: null, // Removed slow latency checking
            error: isActive ? null : 'CouchDB node not in cluster',
            lastSeen: isActive ? new Date().toISOString() : null,
            version: null,
            uptime: null
          };
          
          healthResults.instances.push(health);
          
          if (health.status === 'healthy') {
            healthResults.summary.healthy++;
          } else {
            healthResults.summary.unhealthy++;
            healthResults.summary.isolated.push(instance.id);
          }
        }
      } else {
        throw new Error('Failed to get membership data');
      }
    } catch (error) {
      console.error('Cluster health check error:', error);
      // Fallback: mark all as unknown
      healthResults.instances = this.knownInstances.map(instance => ({
        id: instance.id,
        name: instance.name,
        status: 'unknown',
        error: error.message
      }));
      healthResults.summary.unhealthy = this.knownInstances.length;
      healthResults.summary.isolated = this.knownInstances.map(i => i.id);
    }

    // Track isolation timing
    this.updateIsolationStatus(healthResults.summary.unhealthy > 0);
    
    // Add cluster uptime info
    healthResults.clusterUptime = {
      fullySyncedSince: global.clusterUptimeState.fullySyncedSince,
      uptimeMs: global.clusterUptimeState.fullySyncedSince ? 
                new Date() - global.clusterUptimeState.fullySyncedSince : 0
    };
    
    // Add isolation info for downtime calculation
    healthResults.isolationInfo = this.getIsolationInfo();
    
    this.lastHealthCheck = healthResults;
    return healthResults;
  }

  async checkInstanceHealth(instance) {
    const result = {
      id: instance.id,
      name: instance.name,
      baseUrl: instance.baseUrl,
      status: 'unhealthy',
      responseTime: null,
      error: null,
      lastSeen: null,
      version: null,
      uptime: null
    };

    try {
      const startTime = Date.now();
      
      // Use fetch or curl-like approach to check health endpoint
      const response = await this.makeHealthRequest(instance.baseUrl + '/health');
      
      result.responseTime = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json();
        result.status = data.status === 'ok' ? 'healthy' : 'degraded';
        result.lastSeen = data.timestamp;
        result.version = data.version;
        result.uptime = data.uptime;
      } else {
        result.error = `HTTP ${response.status}`;
      }
    } catch (error) {
      result.error = error.message;
      result.status = 'unreachable';
    }

    return result;
  }

  async checkCouchDBCluster() {
    try {
      if (!this.database) {
        throw new Error('Database not initialized. Call initialize() first.');
      }
      
      // Check cluster membership using CouchDB directly through our database connection
      const db = this.database.getDb();
      
      // Get database credentials from environment variables  
      const dbUser = process.env.COUCHDB_USER || 'admin';
      const dbPassword = process.env.COUCHDB_PASSWORD || 'password';
      
      // Use curl-like approach to check CouchDB membership
      const membershipResponse = await this.makeHealthRequest(`http://${dbUser}:${dbPassword}@couchdb1.zombieauth:5984/_membership`);
      
      if (!membershipResponse.ok) {
        throw new Error(`CouchDB membership check failed: ${membershipResponse.status}`);
      }
      
      const membership = await membershipResponse.json();
      
      // Check node health
      const nodeHealth = {};
      for (const node of membership.all_nodes) {
        try {
          const nodeResponse = await this.makeHealthRequest(`http://${dbUser}:${dbPassword}@couchdb1.zombieauth:5984/_node/${node}/_system`);
          nodeHealth[node] = nodeResponse.ok ? 'up' : 'down';
        } catch (error) {
          nodeHealth[node] = 'unreachable';
        }
      }

      return {
        status: 'healthy',
        allNodes: membership.all_nodes,
        clusterNodes: membership.cluster_nodes,
        nodeHealth,
        summary: {
          totalNodes: membership.all_nodes.length,
          activeNodes: membership.cluster_nodes.length,
          healthyNodes: Object.values(nodeHealth).filter(status => status === 'up').length
        }
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        summary: { totalNodes: 0, activeNodes: 0, healthyNodes: 0 }
      };
    }
  }

  async makeHealthRequest(url) {
    // Use http module for Node.js compatibility
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        timeout: 5000
      };
      
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: () => Promise.resolve(JSON.parse(data))
            });
          } catch (parseError) {
            resolve({
              ok: false,
              status: res.statusCode,
              json: () => Promise.reject(parseError)
            });
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
  }

  // Get current cluster health (cached)
  getCurrentHealth() {
    return this.lastHealthCheck;
  }

  // Check if cluster is in isolation (some instances down)
  isClusterIsolated() {
    if (!this.lastHealthCheck) {
      return { isolated: true, reason: 'Health check not performed' };
    }

    const unhealthy = this.lastHealthCheck.summary.unhealthy;
    if (unhealthy === 0) {
      return { isolated: false };
    }

    return {
      isolated: true,
      reason: `${unhealthy} instance(s) unreachable`,
      isolatedInstances: this.lastHealthCheck.summary.isolated
    };
  }

  // Track when isolation starts/stops using global state
  updateIsolationStatus(currentlyIsolated) {
    if (currentlyIsolated && !global.clusterIsolationState.isolationStartTime) {
      // Isolation just started
      global.clusterIsolationState.isolationStartTime = new Date();
      global.clusterIsolationState.isolatedInstances = this.lastHealthCheck?.summary.isolated || [];
      console.log('Cluster isolation detected, started at:', global.clusterIsolationState.isolationStartTime.toISOString());
    } else if (!currentlyIsolated && global.clusterIsolationState.isolationStartTime) {
      // Isolation ended
      const duration = new Date() - global.clusterIsolationState.isolationStartTime;
      console.log('Cluster isolation ended, duration:', duration, 'ms');
      global.clusterIsolationState.isolationStartTime = null;
      global.clusterIsolationState.isolatedInstances = [];
    } else if (currentlyIsolated && global.clusterIsolationState.isolationStartTime) {
      // Isolation continuing - update isolated instances list
      global.clusterIsolationState.isolatedInstances = this.lastHealthCheck?.summary.isolated || [];
      console.log('Cluster isolation continuing since:', global.clusterIsolationState.isolationStartTime.toISOString());
    }
  }

  // Get records modified since isolation started using global state
  async getIsolatedRecords(recordType = null) {
    if (!global.clusterIsolationState.isolationStartTime || !this.database) {
      return [];
    }

    try {
      const db = this.database.getDb();
      const selector = {
        $and: [
          { 'instanceMetadata.lastModifiedAt': { $gte: global.clusterIsolationState.isolationStartTime.toISOString() } },
          recordType ? { type: recordType } : { type: { $in: ['user', 'client', 'session'] } }
        ]
      };

      console.log('Looking for isolated records modified after:', global.clusterIsolationState.isolationStartTime.toISOString());
      console.log('Selector:', JSON.stringify(selector, null, 2));

      const result = await db.find({
        selector,
        fields: ['_id', '_rev', 'type', 'instanceMetadata', 'username', 'email', 'name', 'clientId', 'userId']
      });

      console.log(`Found ${result.docs.length} records modified since isolation started`);

      return result.docs.map(doc => ({
        ...doc,
        isolatedSince: global.clusterIsolationState.isolationStartTime.toISOString(),
        isolatedNodes: global.clusterIsolationState.isolatedInstances,
        reason: 'Modified while nodes unreachable'
      }));

    } catch (error) {
      console.error('Error getting isolated records:', error);
      return [];
    }
  }

  // Get count of isolated records for dashboard
  async getIsolatedRecordsCount() {
    console.log('getIsolatedRecordsCount: Global isolation state:', {
      isolationStartTime: global.clusterIsolationState.isolationStartTime?.toISOString() || 'null',
      isolatedInstances: global.clusterIsolationState.isolatedInstances
    });
    
    const isolatedRecords = await this.getIsolatedRecords();
    console.log('getIsolatedRecordsCount: Found', isolatedRecords.length, 'isolated records');
    return isolatedRecords.length;
  }

  // Check if a specific record is isolated using global state
  isRecordIsolated(record) {
    if (!global.clusterIsolationState.isolationStartTime || !record.instanceMetadata?.lastModifiedAt) {
      return false;
    }

    const lastModified = new Date(record.instanceMetadata.lastModifiedAt);
    return lastModified >= global.clusterIsolationState.isolationStartTime;
  }

  // Get isolation info for UI display using global state
  getIsolationInfo() {
    return {
      isolated: !!global.clusterIsolationState.isolationStartTime,
      since: global.clusterIsolationState.isolationStartTime,
      isolatedNodes: global.clusterIsolationState.isolatedInstances,
      duration: global.clusterIsolationState.isolationStartTime ? new Date() - global.clusterIsolationState.isolationStartTime : 0
    };
  }

  // Get isolation warning for admin actions using global state
  getIsolationWarning() {
    const isolation = this.isClusterIsolated();
    
    if (!isolation.isolated) {
      return null;
    }

    return {
      severity: 'warning',
      title: 'Cluster Isolation Detected',
      message: `${isolation.reason}. Changes made now may create conflicts when instances reconnect.`,
      isolatedInstances: isolation.isolatedInstances || [],
      isolatedSince: global.clusterIsolationState.isolationStartTime,
      recommendations: [
        'Consider waiting for all instances to reconnect',
        'If urgent, document changes made during isolation',
        'Monitor for conflicts after reconnection'
      ]
    };
  }
}

module.exports = ClusterHealth;