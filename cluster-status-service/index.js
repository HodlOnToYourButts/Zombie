const express = require('express');
const nano = require('nano');

const app = express();
const PORT = process.env.PORT || 3100;

// CouchDB connection with admin credentials
const COUCHDB_URL = process.env.COUCHDB_URL || 'http://localhost:5984';
const COUCHDB_USER = process.env.COUCHDB_ADMIN_USER || 'admin';
const COUCHDB_PASSWORD = process.env.COUCHDB_ADMIN_PASSWORD || 'password';

const couchUrl = COUCHDB_URL.replace('://', `://${COUCHDB_USER}:${COUCHDB_PASSWORD}@`);
const client = nano(couchUrl);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cluster-status',
    timestamp: new Date().toISOString(),
    couchdb_url: COUCHDB_URL.replace(/\/\/.*@/, '//***:***@')
  });
});

// Get sanitized cluster membership information
app.get('/cluster/membership', async (req, res) => {
  try {
    const membership = await client.request({ path: '_membership' });
    
    res.json({
      total_nodes: membership.all_nodes?.length || 0,
      active_nodes: membership.cluster_nodes?.length || 0,
      fully_synced: membership.all_nodes?.length === membership.cluster_nodes?.length,
      nodes: membership.all_nodes?.map(node => ({
        name: node,
        active: membership.cluster_nodes?.includes(node) || false
      })) || [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get cluster membership',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get cluster node health
app.get('/cluster/health', async (req, res) => {
  try {
    const membership = await client.request({ path: '_membership' });
    const nodeHealth = {};
    
    // Check each node's health
    for (const node of membership.all_nodes || []) {
      try {
        await client.request({ path: `_node/${node}/_system` });
        nodeHealth[node] = { status: 'up', accessible: true };
      } catch (error) {
        nodeHealth[node] = { 
          status: 'down', 
          accessible: false,
          error: error.statusCode === 404 ? 'not_found' : 'unreachable'
        };
      }
    }
    
    const totalNodes = membership.all_nodes?.length || 0;
    const healthyNodes = Object.values(nodeHealth).filter(h => h.status === 'up').length;
    
    res.json({
      cluster_status: healthyNodes === totalNodes ? 'healthy' : 'degraded',
      total_nodes: totalNodes,
      healthy_nodes: healthyNodes,
      unhealthy_nodes: totalNodes - healthyNodes,
      nodes: nodeHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check cluster health',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get basic cluster info
app.get('/cluster/info', async (req, res) => {
  try {
    const [membership, serverInfo] = await Promise.all([
      client.request({ path: '_membership' }),
      client.info()
    ]);
    
    res.json({
      cluster: {
        total_nodes: membership.all_nodes?.length || 0,
        active_nodes: membership.cluster_nodes?.length || 0,
        status: membership.all_nodes?.length === membership.cluster_nodes?.length ? 'synced' : 'syncing'
      },
      server: {
        version: serverInfo.version,
        vendor: serverInfo.vendor?.name || 'Apache CouchDB'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get cluster info',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Cluster Status Service running on port ${PORT}`);
  console.log(`CouchDB URL: ${COUCHDB_URL.replace(/\/\/.*@/, '//***:***@')}`);
  console.log('Available endpoints:');
  console.log('  GET /health - Service health check');
  console.log('  GET /cluster/membership - Cluster membership info');
  console.log('  GET /cluster/health - Cluster node health');
  console.log('  GET /cluster/info - Basic cluster information');
});