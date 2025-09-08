# ZombieAuth Multi-Instance Setup

This document describes how to set up and test ZombieAuth's multi-instance, geographically distributed architecture with automatic conflict resolution.

## Architecture Overview

ZombieAuth supports a master-master replication setup designed for geographically distributed deployments:

- **Datacenter 1**: ZombieAuth instance with dedicated CouchDB
- **Datacenter 2**: ZombieAuth instance with dedicated CouchDB  
- **Home Network**: ZombieAuth instance with dedicated CouchDB

Each CouchDB instance maintains bidirectional replication with the others. During network partitions, each location continues operating independently. When connectivity is restored, CouchDB automatically syncs and ZombieAuth provides conflict resolution tools.

## Features

### ✅ Implemented
- **Master-Master CouchDB Replication**: Each instance can operate independently
- **Instance Metadata Tracking**: All documents track origin and modification history
- **Automatic Conflict Detection**: System identifies conflicting documents after sync
- **Admin Conflict Resolution UI**: Graphical interface for resolving conflicts
- **Network Partition Testing**: Scripts to simulate real-world network failures
- **Instance Health Monitoring**: Real-time replication and conflict status

### 🎯 Use Cases
- **Home Instance Isolation**: Home users can authenticate during internet outages
- **Datacenter Split**: Services remain available during inter-datacenter network issues
- **Geographic Distribution**: Low latency authentication across multiple regions
- **Conflict Resolution**: Admins can merge or choose between conflicting user records

## Quick Start

### Prerequisites
- **Container Engine**: Docker with docker-compose OR Podman with podman-compose (automatically detected)
- `jq` for testing scripts: `sudo apt install jq`

**Note**: The scripts automatically detect whether you're using Docker or Podman and use the appropriate commands (`docker-compose` vs `podman-compose`). Docker is checked first alphabetically if both are available.

### 1. Start the Cluster
```bash
./scripts/start-zombieauth.sh
```

This will start:
- 3 CouchDB instances (ports 5984, 5985, 5986)
- 3 ZombieAuth instances (ports 3000, 3001, 3002)

### 2. Access the Admin Interface
- **DC1**: http://localhost:3000/admin
- **DC2**: http://localhost:3001/admin
- **Home**: http://localhost:3002/admin

**Default Admin Credentials:**
- Username: `admin`
- Password: `admin`

The default admin user is automatically created on all instances during startup.

### 3. Test Network Partitions
```bash
# Test home instance isolation
./scripts/test-network-partition.sh home

# Test datacenter split
./scripts/test-network-partition.sh split

# Run all tests
./scripts/test-network-partition.sh all
```

## Detailed Setup

### Environment Variables

Each instance uses these environment variables:

```bash
# Instance identification
INSTANCE_ID=datacenter1|datacenter2|home
INSTANCE_LOCATION=datacenter1|datacenter2|home

# CouchDB configuration  
PRIMARY_COUCHDB_URL=http://couchdb1:5984  # This instance's CouchDB
PEER_COUCHDB_URLS=http://couchdb2:5984,http://couchdb3:5984  # Other CouchDBs
COUCHDB_USER=admin
COUCHDB_PASSWORD=password
COUCHDB_DATABASE=zombieauth
```

### Manual Container Commands

If you prefer manual control, use either Docker or Podman:

```bash
# With Docker
docker-compose up -d couchdb1 couchdb2 couchdb3
docker-compose up -d zombieauth1 zombieauth2 zombieauth3

# With Podman
podman-compose up -d couchdb1 couchdb2 couchdb3
podman-compose up -d zombieauth1 zombieauth2 zombieauth3

# Or use the container utils (after sourcing scripts/container-utils.sh)
source scripts/container-utils.sh
detect_container_engine
compose_cmd up -d
```

## Conflict Resolution

### Conflict Types

The system detects several types of conflicts:

1. **User Group Conflicts**: Same user assigned different groups on different instances
2. **User Role Conflicts**: Same user assigned different roles on different instances  
3. **Profile Conflicts**: Username or email changes on different instances
4. **Client Configuration Conflicts**: OAuth client settings modified differently

### Conflict Resolution Options

1. **Choose Winner**: Select one version as correct, discard others
2. **Merge Permissions**: Combine groups/roles from all versions
3. **Custom Resolution**: Manually edit merged data before applying

### Conflict Resolution UI

Navigate to **Admin > Conflicts** to:

- View all document conflicts across the cluster
- See detailed version comparisons with instance metadata
- Apply resolution strategies (winner selection or merge)
- Track conflict resolution history

## Testing Scenarios

### Scenario 1: Home Instance Isolation

Simulates home internet outage:

```bash
./scripts/test-network-partition.sh home
```

**What it does:**
1. Creates users on all instances
2. Isolates home instance for 60 seconds
3. Creates conflicting users during isolation
4. Restores connectivity and checks for conflicts

**Expected Result:** Conflict detected for users created with same name but different groups.

### Scenario 2: Datacenter Split

Simulates network partition between datacenters:

```bash
./scripts/test-network-partition.sh split
```

**What it does:**
1. Creates users across datacenters
2. Partitions DC1 and DC2 for 45 seconds
3. Creates conflicting data during partition
4. Restores connectivity and analyzes conflicts

**Expected Result:** Multiple conflicts requiring manual resolution.

### Scenario 3: Production-Like Test

For comprehensive testing:

1. Create users on different instances
2. Modify same user on multiple instances simultaneously
3. The testing scripts now use container start/stop to simulate network partitions (more effective than proxy-based approaches)

## Monitoring and Troubleshooting

### Health Checks

```bash
# Check all instance health
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
```

### Replication Status

```bash
# Get replication status for an instance
curl http://localhost:3000/admin/api/replication/status | jq .
```

### Conflict Statistics

**Development/Testing (with ENABLE_TEST_ENDPOINTS=true):**
```bash
# Get conflict summary (unprotected test endpoint)
curl http://localhost:3000/test/conflicts/stats | jq .

# Get user conflicts
curl http://localhost:3000/test/conflicts/users | jq .

# Get all conflicts
curl http://localhost:3000/test/conflicts | jq .

# Get replication status
curl http://localhost:3000/test/replication/status | jq .
```

**Production (protected admin API - requires authentication):**
```bash
# Get conflict summary (requires OIDC authentication)
curl http://localhost:3000/admin/api/conflicts/stats | jq .
```

**⚠️ Important:** For production deployment, ensure `ENABLE_TEST_ENDPOINTS` is **not** set to `true` to disable unprotected test endpoints.

### CouchDB Direct Access

```bash
# Check CouchDB replication documents
curl http://admin:password@localhost:5984/_replicator/_all_docs?include_docs=true

# Check for conflicts in a specific document
curl http://admin:password@localhost:5984/zombieauth/user:example?conflicts=true
```

### Common Issues

**Replication not working:**
- Verify CouchDB instances are healthy
- Check network connectivity between containers
- Ensure proper credentials in environment variables

**Conflicts not detected:**
- Wait 30-60 seconds after changes for replication to complete
- Check CouchDB logs: `docker logs zombieauth-couchdb1`
- Verify conflict detection views are created

**Admin interface errors:**
- Check ZombieAuth logs: `docker logs zombieauth-dc1`
- Verify OIDC authentication is working
- Ensure admin user has proper roles

## Production Deployment

### Security Considerations

1. **Change Default Credentials**:
   ```bash
   # Update docker-compose.yml
   COUCHDB_USER=your_admin_user
   COUCHDB_PASSWORD=strong_random_password
   COUCHDB_SECRET=different_strong_secret
   ```

2. **Use HTTPS**:
   - Configure SSL certificates in your reverse proxy (nginx, Apache, etc.)
   - Update ISSUER URLs to use https://

3. **Network Security**:
   - Restrict CouchDB ports to internal networks only
   - Use VPN or private networks between datacenters
   - Configure firewall rules appropriately

### Performance Tuning

1. **CouchDB Configuration**:
   ```ini
   # Add to scripts/local.ini
   [couchdb]
   max_document_size = 67108864
   
   [replicator]
   max_replication_retry_count = 10
   
   [httpd]
   max_connections = 2048
   ```

2. **Reverse Proxy Configuration** (if using one in production):
   - Adjust worker processes based on CPU cores
   - Tune connection limits and timeouts
   - Enable gzip compression for better performance

### Backup Strategy

1. **CouchDB Backups**:
   ```bash
   # Regular backup of each CouchDB instance
   curl -X GET http://admin:password@localhost:5984/zombieauth/_all_docs?include_docs=true > backup.json
   ```

2. **Configuration Backups**:
   - Store docker-compose.yml and environment files in version control
   - Backup reverse proxy configuration and SSL certificates (if using)

## Advanced Configuration

### Custom Conflict Resolution Logic

You can extend the conflict detection system by modifying:

- `src/services/conflict-detector.js`: Add custom conflict analysis
- `src/routes/admin-api.js`: Add custom resolution endpoints
- `src/public/js/admin-conflicts.js`: Extend the UI with custom resolution options

### Integration with External Systems

The system provides REST APIs for:

- Conflict monitoring: `GET /admin/api/conflicts/stats`
- Automated resolution: `POST /admin/api/conflicts/{id}/resolve`
- Replication status: `GET /admin/api/replication/status`

These can be integrated with monitoring systems like Prometheus/Grafana or custom dashboards.

## Troubleshooting Guide

### Network Partition Recovery

If instances don't sync after network recovery:

1. Check replication status: `GET /admin/api/replication/status`
2. Restart replication: Stop and start docker containers
3. Manual sync trigger: Restart CouchDB containers if needed
4. Check logs for specific error messages

### Conflict Resolution Issues

If conflicts persist after resolution:

1. Verify all conflicting revisions were deleted
2. Check document history: `GET http://couchdb:5984/db/doc?revs_info=true`
3. Manual cleanup: Use CouchDB's `_purge` endpoint for stubborn conflicts

### Performance Issues

If replication is slow:

1. Check network latency between instances
2. Monitor CouchDB resource usage
3. Consider increasing replication batch sizes
4. Implement data filtering to reduce replication load

## Support and Development

### Logs Location

**With Docker:**
- ZombieAuth: `docker logs zombieauth-dc1`
- CouchDB: `docker logs zombieauth-couchdb1`

**With Podman:**
- ZombieAuth: `podman logs zombieauth-dc1`
- CouchDB: `podman logs zombieauth-couchdb1`

**Or use the container utils:**
```bash
source scripts/container-utils.sh
detect_container_engine
get_container_logs zombieauth-dc1 100
```

### Development

To contribute or modify the multi-instance functionality:

1. Core replication logic: `src/database.js`
2. Conflict detection: `src/services/conflict-detector.js`
3. Admin interface: `src/views/conflicts.html` + `src/public/js/admin-conflicts.js`
4. Testing scripts: `scripts/test-network-partition.sh`

### Testing in Development

```bash
# Run tests with detailed logging
DEBUG=* ./scripts/test-network-partition.sh all

# Manual conflict creation for testing
curl -X POST http://localhost:3000/admin/api/users \
  -d '{"username":"test","groups":"admin"}' \
  -H "Content-Type: application/json"

curl -X POST http://localhost:3002/admin/api/users \
  -d '{"username":"test","groups":"users"}' \
  -H "Content-Type: application/json"
```

## Conclusion

ZombieAuth's multi-instance architecture provides robust authentication services that can withstand network partitions while maintaining data consistency through intelligent conflict resolution. The system is designed for real-world scenarios where geographic distribution and network reliability are concerns.

For questions or issues, check the logs, use the provided testing scripts, and refer to the troubleshooting guide above.