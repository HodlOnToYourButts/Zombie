const { v4: uuidv4 } = require('uuid');
const os = require('os');
const EventEmitter = require('events');

class NodeDiscovery extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.nodeId = options.nodeId || `node:${uuidv4()}`;
    this.port = options.port || process.env.PORT || 3000;
    this.discoveryPort = options.discoveryPort || 4000;
    this.announceInterval = options.announceInterval || 30000; // 30 seconds
    this.heartbeatTimeout = options.heartbeatTimeout || 90000; // 90 seconds
    
    this.peers = new Map();
    this.isRunning = false;
    this.announceTimer = null;
    this.cleanupTimer = null;
    
    // Get local IP addresses
    this.localIPs = this.getLocalIPs();
  }
  
  getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    for (const interfaceName in interfaces) {
      for (const networkInterface of interfaces[interfaceName]) {
        if (networkInterface.family === 'IPv4' && !networkInterface.internal) {
          ips.push(networkInterface.address);
        }
      }
    }
    
    return ips;
  }
  
  async start() {
    if (this.isRunning) return;
    
    console.log(`Starting node discovery service for node ${this.nodeId}`);
    console.log(`Local IPs: ${this.localIPs.join(', ')}`);
    
    // Start UDP discovery service
    await this.startUDPDiscovery();
    
    // Start announcing this node
    this.startAnnouncing();
    
    // Start cleanup timer for dead nodes
    this.startCleanup();
    
    this.isRunning = true;
    console.log(`Node discovery service started on port ${this.discoveryPort}`);
  }
  
  async stop() {
    if (!this.isRunning) return;
    
    console.log('Stopping node discovery service...');
    
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.udpServer) {
      this.udpServer.close();
      this.udpServer = null;
    }
    
    this.isRunning = false;
    console.log('Node discovery service stopped');
  }
  
  async startUDPDiscovery() {
    const dgram = require('dgram');
    this.udpServer = dgram.createSocket('udp4');
    
    this.udpServer.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        this.handleDiscoveryMessage(data, rinfo);
      } catch (error) {
        console.error('Error parsing discovery message:', error);
      }
    });
    
    this.udpServer.on('error', (error) => {
      console.error('UDP discovery error:', error);
    });
    
    return new Promise((resolve, reject) => {
      this.udpServer.bind(this.discoveryPort, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
  
  handleDiscoveryMessage(data, rinfo) {
    if (data.type === 'node-announce' && data.nodeId !== this.nodeId) {
      const peer = {
        nodeId: data.nodeId,
        host: data.host || rinfo.address,
        port: data.port,
        lastSeen: Date.now(),
        metadata: data.metadata || {}
      };
      
      const wasNew = !this.peers.has(peer.nodeId);
      this.peers.set(peer.nodeId, peer);
      
      if (wasNew) {
        console.log(`Discovered new peer: ${peer.nodeId} at ${peer.host}:${peer.port}`);
        this.emit('peer-discovered', peer);
      } else {
        this.emit('peer-updated', peer);
      }
      
      // Send response to acknowledge discovery
      this.sendDiscoveryResponse(peer.host, rinfo.port);
    } else if (data.type === 'node-response' && data.nodeId !== this.nodeId) {
      // Handle discovery response
      const peer = {
        nodeId: data.nodeId,
        host: data.host || rinfo.address,
        port: data.port,
        lastSeen: Date.now(),
        metadata: data.metadata || {}
      };
      
      if (!this.peers.has(peer.nodeId)) {
        console.log(`Received response from new peer: ${peer.nodeId} at ${peer.host}:${peer.port}`);
        this.peers.set(peer.nodeId, peer);
        this.emit('peer-discovered', peer);
      }
    }
  }
  
  startAnnouncing() {
    const announce = () => {
      const message = {
        type: 'node-announce',
        nodeId: this.nodeId,
        host: this.localIPs[0], // Use first local IP
        port: this.port,
        timestamp: Date.now(),
        metadata: {
          version: '0.1.0',
          capabilities: ['replication', 'conflict-resolution']
        }
      };
      
      this.broadcastMessage(message);
    };
    
    // Announce immediately and then on interval
    announce();
    this.announceTimer = setInterval(announce, this.announceInterval);
  }
  
  sendDiscoveryResponse(host, port) {
    const message = {
      type: 'node-response',
      nodeId: this.nodeId,
      host: this.localIPs[0],
      port: this.port,
      timestamp: Date.now(),
      metadata: {
        version: '0.1.0',
        capabilities: ['replication', 'conflict-resolution']
      }
    };
    
    this.sendUDPMessage(message, host, port);
  }
  
  broadcastMessage(message) {
    const dgram = require('dgram');
    const client = dgram.createSocket('udp4');
    const messageBuffer = Buffer.from(JSON.stringify(message));
    
    // Broadcast to local network
    const broadcastAddress = '255.255.255.255';
    
    client.send(messageBuffer, this.discoveryPort, broadcastAddress, (error) => {
      if (error) {
        console.error('Error broadcasting message:', error);
      }
      client.close();
    });
  }
  
  sendUDPMessage(message, host, port) {
    const dgram = require('dgram');
    const client = dgram.createSocket('udp4');
    const messageBuffer = Buffer.from(JSON.stringify(message));
    
    client.send(messageBuffer, port, host, (error) => {
      if (error) {
        console.error(`Error sending message to ${host}:${port}:`, error);
      }
      client.close();
    });
  }
  
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const deadNodes = [];
      
      for (const [nodeId, peer] of this.peers) {
        if (now - peer.lastSeen > this.heartbeatTimeout) {
          deadNodes.push(nodeId);
        }
      }
      
      for (const nodeId of deadNodes) {
        const peer = this.peers.get(nodeId);
        this.peers.delete(nodeId);
        console.log(`Removed dead peer: ${nodeId}`);
        this.emit('peer-lost', peer);
      }
    }, 30000); // Check every 30 seconds
  }
  
  getPeers() {
    return Array.from(this.peers.values());
  }
  
  getPeer(nodeId) {
    return this.peers.get(nodeId);
  }
  
  getNodeId() {
    return this.nodeId;
  }
  
  isNodeAlive(nodeId) {
    const peer = this.peers.get(nodeId);
    if (!peer) return false;
    
    return (Date.now() - peer.lastSeen) < this.heartbeatTimeout;
  }
}

module.exports = NodeDiscovery;