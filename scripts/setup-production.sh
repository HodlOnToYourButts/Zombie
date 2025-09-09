#!/bin/bash

# ZombieAuth Production Cluster Setup Script
# Configures CouchDB clustering and initializes ZombieAuth database
set -e

echo "🔧 Setting up ZombieAuth production cluster..."

# Default values
PRODUCTION_DIR="./production"
ENV_FILE=""
INSTANCE_NAMES=""
SKIP_CLUSTER_SETUP=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --production-dir)
      PRODUCTION_DIR="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-cluster-setup)
      SKIP_CLUSTER_SETUP=true
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --production-dir <path>   Production directory (default: ./production)"
      echo "  --env-file <path>         Environment file (default: <production-dir>/production.env)"
      echo "  --skip-cluster-setup      Skip CouchDB cluster setup (database init only)"
      echo "  --help                    Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Set default ENV_FILE if not specified
if [ -z "$ENV_FILE" ]; then
    ENV_FILE="$PRODUCTION_DIR/production.env"
fi

# Load production configuration
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
else
  echo "❌ Error: $ENV_FILE not found. Run ./scripts/create-production.sh first."
  exit 1
fi

# Parse instance names and domains
if [ -z "$INSTANCE_NAMES" ]; then
  echo "❌ Error: INSTANCE_NAMES not found in $ENV_FILE"
  exit 1
fi

IFS=',' read -ra NAMES_ARRAY <<< "$INSTANCE_NAMES"
IFS=',' read -ra DOMAINS_ARRAY <<< "$INSTANCE_DOMAINS"

echo "📋 Production Configuration:"
echo "  Instances: ${NAMES_ARRAY[*]}"
echo "  Domains: ${DOMAINS_ARRAY[*]}"
echo "  Skip cluster setup: $SKIP_CLUSTER_SETUP"
echo ""

# Function to wait for CouchDB to be ready
wait_for_couchdb() {
    local instance_name="$1"
    local max_attempts=30
    local attempt=1
    
    echo "⏳ Waiting for CouchDB on $instance_name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "http://localhost:5984/_up" > /dev/null 2>&1; then
            echo "✅ CouchDB on $instance_name is ready"
            return 0
        fi
        
        echo "   Attempt $attempt/$max_attempts - waiting 5 seconds..."
        sleep 5
        attempt=$((attempt + 1))
    done
    
    echo "❌ CouchDB on $instance_name failed to become ready after $max_attempts attempts"
    return 1
}

# Function to setup CouchDB cluster
setup_couchdb_cluster() {
    echo "🗄️  Setting up CouchDB cluster..."
    
    # Wait for all CouchDB instances to be ready
    for i in "${!NAMES_ARRAY[@]}"; do
        wait_for_couchdb "${NAMES_ARRAY[$i]}" || exit 1
    done
    
    echo "🔧 Configuring bind addresses..."
    for i in "${!NAMES_ARRAY[@]}"; do
        echo "   Configuring bind address for ${DOMAINS_ARRAY[$i]}..."
        curl -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@${DOMAINS_ARRAY[$i]}:5984/_node/_local/_config/chttpd/bind_address" -d '"0.0.0.0"' -s >/dev/null 2>&1 || true
    done
    
    echo "🔗 Adding nodes to cluster..."
    # Add additional nodes to cluster (skip first node as it's the coordinator)
    for i in "${!NAMES_ARRAY[@]}"; do
        if [ $i -gt 0 ]; then
            echo "   Adding ${DOMAINS_ARRAY[$i]} to cluster..."
            curl -s -X POST "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@${DOMAINS_ARRAY[0]}:5984/_cluster_setup" \
                -H "Content-Type: application/json" \
                -d "{
                    \"action\": \"add_node\",
                    \"host\": \"${DOMAINS_ARRAY[$i]}\",
                    \"port\": 5984,
                    \"username\": \"$COUCHDB_ADMIN_USER\",
                    \"password\": \"$COUCHDB_ADMIN_PASSWORD\"
                }" >/dev/null 2>&1 || echo "   Node ${DOMAINS_ARRAY[$i]} already in cluster or failed to add"
        fi
    done
    
    echo "🏁 Finishing cluster setup..."
    curl -s -X POST "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@${DOMAINS_ARRAY[0]}:5984/_cluster_setup" \
        -H "Content-Type: application/json" \
        -d '{
            "action": "finish_cluster"
        }' >/dev/null 2>&1 || echo "Cluster already finished"
    
    echo "✅ CouchDB cluster configuration complete"
}

# Function to initialize ZombieAuth database
initialize_zombieauth_database() {
    echo "🧟 Initializing ZombieAuth database..."
    
    # Create ZombieAuth application user first
    echo "   Creating ZombieAuth application user: $ZOMBIEAUTH_USER..."
    curl -s -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@${DOMAINS_ARRAY[0]}:5984/_users/org.couchdb.user:$ZOMBIEAUTH_USER" \
        -H "Content-Type: application/json" \
        -d "{
            \"_id\": \"org.couchdb.user:$ZOMBIEAUTH_USER\",
            \"name\": \"$ZOMBIEAUTH_USER\",
            \"roles\": [],
            \"type\": \"user\",
            \"password\": \"$ZOMBIEAUTH_PASSWORD\"
        }" >/dev/null 2>&1 || echo "   User may already exist"
    
    # Create/ensure ZombieAuth database exists with proper permissions
    echo "   Creating ZombieAuth database..."
    curl -s -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@${DOMAINS_ARRAY[0]}:5984/zombieauth" >/dev/null 2>&1 || echo "   Database may already exist"
    
    # Set database permissions for ZombieAuth user (make it a database admin)
    echo "   Setting database permissions..."
    curl -s -X PUT "http://$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD@${DOMAINS_ARRAY[0]}:5984/zombieauth/_security" \
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
    
    echo "✅ ZombieAuth database initialization complete"
}

# Function to verify cluster health
verify_cluster_health() {
    echo "🔍 Verifying cluster health..."
    
    # Check cluster membership
    echo "   Checking cluster membership..."
    MEMBERSHIP=$(curl -s "http://${COUCHDB_ADMIN_USER}:${COUCHDB_ADMIN_PASSWORD}@${DOMAINS_ARRAY[0]}:5984/_membership")
    echo "   Cluster membership: $MEMBERSHIP"
    
    # Check database info
    echo "   Checking zombieauth database..."
    DB_INFO=$(curl -s "http://${COUCHDB_ADMIN_USER}:${COUCHDB_ADMIN_PASSWORD}@${DOMAINS_ARRAY[0]}:5984/zombieauth")
    echo "   Database info: $DB_INFO"
    
    echo "✅ Cluster health verification complete"
}

# Main execution
echo "🚀 Starting cluster setup process..."

# Setup CouchDB cluster if not skipped
if [ "$SKIP_CLUSTER_SETUP" = false ]; then
    setup_couchdb_cluster
fi

# Initialize ZombieAuth database
initialize_zombieauth_database

# Verify cluster health
verify_cluster_health

echo ""
echo "✅ Production cluster setup complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Verify all systemd services are running:"
echo "   sudo systemctl status couchdb.service"
echo "   sudo systemctl status couchdb-status.service"
echo "   sudo systemctl status zombieauth.service"
echo "   sudo systemctl status zombieauth-admin.service"
echo ""
echo "2. Configure Traefik routing for your domains:"
for i in "${!NAMES_ARRAY[@]}"; do
    echo "   OIDC: ${DOMAINS_ARRAY[$i]} → zombieauth.service"
    echo "   Admin: admin.${DOMAINS_ARRAY[$i]} → zombieauth-admin.service"
done
echo ""
echo "3. Test the installation:"
echo "   curl http://localhost:5984/_up"
echo "   curl http://localhost/_well-known/openid_configuration"
echo ""
echo "🔐 Admin Credentials:"
echo "   Username: admin"
echo "   Password: $ADMIN_PASSWORD"
echo "   Client ID: $SHARED_CLIENT_ID"