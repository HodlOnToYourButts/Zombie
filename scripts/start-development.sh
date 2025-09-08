#!/bin/bash

# ZombieAuth Development Startup Script
# Handles CouchDB cluster setup and ZombieAuth instance startup for development
set -e

# Source container utilities
source "$(dirname "$0")/container-utils.sh"

echo "Starting ZombieAuth development cluster..."

# Detect container engine
detect_container_engine || exit 1
check_container_engine || exit 1

# Check if CouchDB deployment is fresh
echo "Checking if CouchDB deployment is fresh..."
FRESH_DEPLOYMENT=false

# Check if any CouchDB volume exists and has data
VOLUME_PATTERN="^development_couchdb[0-9]+_data$"
EXISTING_VOLUMES=$(container_cmd volume ls --format "{{.Name}}" 2>/dev/null | grep -E "$VOLUME_PATTERN" | wc -l)

if [ "$EXISTING_VOLUMES" -lt $INSTANCE_COUNT ]; then
  FRESH_DEPLOYMENT=true
  log "Fresh deployment detected - CouchDB volumes don't exist"
else
  # Check if volumes are empty by examining if CouchDB data directory exists
  if ! container_cmd run --rm -v development_couchdb1_data:/data alpine test -f /data/.couch_node_name 2>/dev/null; then
    FRESH_DEPLOYMENT=true
    log "Fresh deployment detected - CouchDB volumes are empty"
  else
    log "Existing deployment detected - skipping cluster setup"
  fi
fi

# Load development configuration to get instance count and names
if [ -f "development/development.env" ]; then
  source development/development.env
else
  echo "❌ Error: development/development.env not found. Run ./scripts/create-development.sh first."
  exit 1
fi

# Parse instance names
IFS=',' read -ra NAMES_ARRAY <<< "$INSTANCE_NAMES"

# Start CouchDB containers
log "Starting CouchDB containers..."
COUCHDB_SERVICES=""
for i in "${!NAMES_ARRAY[@]}"; do
  if [ -n "$COUCHDB_SERVICES" ]; then
    COUCHDB_SERVICES+=" "
  fi
  COUCHDB_SERVICES+="couchdb$((i+1))"
done
(cd development && compose_cmd up -d $COUCHDB_SERVICES) >/dev/null

# Wait for CouchDB containers to be ready
log "Waiting for CouchDB instances to start..."
for i in "${!NAMES_ARRAY[@]}"; do
  wait_for_container "zombieauth-couchdb$((i+1))"
done
sleep 15

if [ "$FRESH_DEPLOYMENT" = true ]; then
  log "Setting up CouchDB cluster..."

  # Load CouchDB credentials from development.env
  if [ -f "development/development.env" ]; then
    source development/development.env
    echo "Using CouchDB credentials: user=$COUCHDB_ADMIN_USER"
  else
    echo "❌ Error: development/development.env not found. Run ./scripts/create-development.sh first."
    exit 1
  fi

# Configure basic settings for cluster (CouchDB 3.x handles UUID/secret automatically)
echo "Configuring nodes for clustering..."

echo "Configuring bind addresses..."
for i in "${!NAMES_ARRAY[@]}"; do
  COUCHDB_PORT=$((COUCHDB_BASE_PORT + i))
  curl -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_PORT/_node/_local/_config/chttpd/bind_address" -d '"0.0.0.0"' -s >/dev/null 2>&1 || true
done

# Add additional nodes to cluster (skip first node as it's the coordinator)
for i in "${!NAMES_ARRAY[@]}"; do
  if [ $i -gt 0 ]; then
    NODE_NUM=$((i+1))
    echo "Adding couchdb$NODE_NUM to cluster..."
    curl -s -X POST "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_BASE_PORT/_cluster_setup" \
      -H "Content-Type: application/json" \
      -d "{
        \"action\": \"add_node\",
        \"host\": \"couchdb$NODE_NUM.zombieauth\",
        \"port\": 5984,
        \"username\": \"$COUCHDB_ADMIN_USER\",
        \"password\": \"$COUCHDB_ADMIN_PASSWORD\"
      }" >/dev/null 2>&1 || echo "Node $NODE_NUM already in cluster or failed to add"
  fi
done

# Finish cluster setup
echo "Finishing cluster setup..."
curl -s -X POST "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_BASE_PORT/_cluster_setup" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "finish_cluster"
  }' >/dev/null 2>&1 || echo "Cluster already finished"

echo "Checking cluster membership..."
curl -s "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_BASE_PORT/_membership" | jq .

# Create ZombieAuth application user
echo "Creating ZombieAuth application user..."
curl -s -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_BASE_PORT/_users/org.couchdb.user:$ZOMBIEAUTH_USER" \
  -H "Content-Type: application/json" \
  -d "{
    \"_id\": \"org.couchdb.user:$ZOMBIEAUTH_USER\",
    \"name\": \"$ZOMBIEAUTH_USER\",
    \"roles\": [],
    \"type\": \"user\",
    \"password\": \"$ZOMBIEAUTH_PASSWORD\"
  }" >/dev/null 2>&1 || echo "User may already exist"

# Create/ensure ZombieAuth database exists with proper permissions
echo "Creating ZombieAuth database..."
curl -s -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_BASE_PORT/zombieauth" >/dev/null 2>&1 || echo "Database may already exist"

# Set database permissions for ZombieAuth user (make it a database admin)
echo "Setting database permissions..."
curl -s -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@localhost:$COUCHDB_BASE_PORT/zombieauth/_security" \
  -H "Content-Type: application/json" \
  -d "{
    \"admins\": {
      \"names\": [\"$COUCHDB_ADMIN_USER\", \"$ZOMBIEAUTH_USER\"],
      \"roles\": []
    },
    \"members\": {
      \"names\": [\"$ZOMBIEAUTH_USER\"],
      \"roles\": []
    }
  }" >/dev/null 2>&1

  echo "Cluster setup complete!"
else
  log "Using existing CouchDB cluster"
fi

# Start cluster status services
log "Starting cluster status services..."
STATUS_SERVICES=""
for i in "${!NAMES_ARRAY[@]}"; do
  if [ -n "$STATUS_SERVICES" ]; then
    STATUS_SERVICES+=" "
  fi
  STATUS_SERVICES+="couchdb$((i+1))-status"
done
(cd development && compose_cmd up -d --no-deps $STATUS_SERVICES) >/dev/null

# Wait for status services to be ready
log "Waiting for cluster status services to start..."
for i in "${!NAMES_ARRAY[@]}"; do
  wait_for_container "zombieauth-couchdb$((i+1))-status"
done

# Start ZombieAuth instances (without dependencies since CouchDB is already running)
log "Starting ZombieAuth instances..."
ZOMBIEAUTH_SERVICES=""
for i in "${!NAMES_ARRAY[@]}"; do
  if [ -n "$ZOMBIEAUTH_SERVICES" ]; then
    ZOMBIEAUTH_SERVICES+=" "
  fi
  ZOMBIEAUTH_SERVICES+="zombieauth$((i+1))"
done
(cd development && compose_cmd up -d --no-deps $ZOMBIEAUTH_SERVICES) >/dev/null

# Wait for ZombieAuth instances to be ready  
log "Waiting for ZombieAuth instances to start..."
for i in "${!NAMES_ARRAY[@]}"; do
  INSTANCE_NAME="${NAMES_ARRAY[$i]}"
  wait_for_container "zombieauth-$INSTANCE_NAME"
done

log "ZombieAuth development cluster complete!"
log "Services available at:"
for i in "${!NAMES_ARRAY[@]}"; do
  INSTANCE_NAME="${NAMES_ARRAY[$i]}"
  INSTANCE_PORT=$((BASE_PORT + i))
  log "  - $INSTANCE_NAME: http://localhost:$INSTANCE_PORT/admin"
done