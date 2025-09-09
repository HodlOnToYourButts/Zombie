#!/bin/bash

# Generate docker-compose.yml for ZombieAuth development cluster
# Usage: ./create-development.sh [options]
# Options:
#   --instances <count>           Number of instances (default: 3)
#   --names <name1,name2,...>     Instance names (comma-separated, default: node1,node2,node3)
#   --base-port <port>           Base port for ZombieAuth instances (default: 3000)
#   --couchdb-base-port <port>   Base port for CouchDB instances (default: 5984)
#   --status-base-port <port>    Base port for status services (default: 3100)
#   --env-file <path>            Use existing .env file (default: ./development/development.env)
#   --regenerate-secrets         Force regeneration of secrets even if .env exists
#   --help                       Show this help

set -e

# Default values
INSTANCE_COUNT=3
INSTANCE_NAMES="node1,node2,node3"
BASE_PORT=3000
COUCHDB_BASE_PORT=5984
STATUS_BASE_PORT=3100
ENV_FILE="./development/development.env"
REGENERATE_SECRETS=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --instances)
      INSTANCE_COUNT="$2"
      shift 2
      ;;
    --names)
      INSTANCE_NAMES="$2"
      shift 2
      ;;
    --base-port)
      BASE_PORT="$2"
      shift 2
      ;;
    --couchdb-base-port)
      COUCHDB_BASE_PORT="$2"
      shift 2
      ;;
    --status-base-port)
      STATUS_BASE_PORT="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --regenerate-secrets)
      REGENERATE_SECRETS=true
      shift
      ;;
    --help)
      head -13 "$0" | tail -11
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Change to project root and create development directory
cd "$PROJECT_ROOT"
mkdir -p development

echo "🐧 Creating docker-compose.yml for ZombieAuth development cluster..."
echo "Instances: $INSTANCE_COUNT"
echo "Base Port: $BASE_PORT"
echo "CouchDB Base Port: $COUCHDB_BASE_PORT"
echo "Status Base Port: $STATUS_BASE_PORT"
echo "Environment File: $ENV_FILE"
echo "================================================"

# Parse instance names
IFS=',' read -ra NAMES_ARRAY <<< "$INSTANCE_NAMES"
if [ ${#NAMES_ARRAY[@]} -ne $INSTANCE_COUNT ]; then
    echo "⚠️  Instance count ($INSTANCE_COUNT) doesn't match names provided (${#NAMES_ARRAY[@]})"
    echo "Generating default names..."
    NAMES_ARRAY=()
    for i in $(seq 1 $INSTANCE_COUNT); do
        NAMES_ARRAY+=("node$i")
    done
    INSTANCE_NAMES=$(IFS=','; echo "${NAMES_ARRAY[*]}")
fi

echo "Instance names: ${NAMES_ARRAY[*]}"

# Function to generate a random alphanumeric string
generate_random_string() {
    local length=$1
    openssl rand -base64 $((length * 3 / 4)) | tr -d "=+/" | cut -c1-${length}
}

# Function to generate a simple alphanumeric password (no special chars to avoid sed issues)
generate_simple_password() {
    local length=${1:-16}
    openssl rand -base64 $((length * 3 / 4)) | tr -d "=+/" | cut -c1-${length}
}

# Load or generate secrets
if [ -f "$ENV_FILE" ] && [ "$REGENERATE_SECRETS" = false ]; then
    echo "📂 Loading existing secrets from $ENV_FILE..."
    source "$ENV_FILE"
    echo "✅ Loaded existing secrets"
else
    echo "🔐 Generating new secrets..."
    
    # CouchDB Admin User (shared across cluster)
    COUCHDB_ADMIN_USER="admin"
    COUCHDB_ADMIN_PASSWORD=$(generate_simple_password 16)

    # Application User (for ZombieAuth)
    ZOMBIEAUTH_USER="zombieauth"
    ZOMBIEAUTH_PASSWORD=$(generate_simple_password 16)
    COUCHDB_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    COUCHDB_COOKIE=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)

    # Development mode - use simple admin credentials
    ADMIN_USERNAME="admin"
    ADMIN_PASSWORD="admin"

    JWT_SECRET=$(openssl rand -base64 32)
    SESSION_SECRET=$(openssl rand -base64 32)
    ADMIN_CLIENT_SECRET=$(openssl rand -base64 32)

    # Generate client ID in correct format (client_ + 32 hex chars)
    CLIENT_ID_HEX=$(openssl rand -hex 16)
    DEFAULT_CLIENT_ID="client_${CLIENT_ID_HEX}"

    # Development mode - always enable test endpoints
    ENABLE_TEST_ENDPOINTS="true"
    
    echo "✅ Generated new secrets"
fi

echo "🔧 Development mode: test endpoints enabled"

# Generate cluster configuration JSON
CLUSTER_INSTANCES="["
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    INSTANCE_PORT=$((BASE_PORT + i))
    
    if [ $i -gt 0 ]; then
        CLUSTER_INSTANCES+=","
    fi
    
    DISPLAY_NAME="$(echo $INSTANCE_NAME | sed 's/./\U&/' | sed 's/_/ /g')"
    BASE_URL="http://localhost:${INSTANCE_PORT}"
    STATUS_URL="http://couchdb$((i+1))-status:3100"
    
    CLUSTER_INSTANCES+="{\"id\":\"$INSTANCE_NAME\",\"name\":\"$DISPLAY_NAME\",\"baseUrl\":\"$BASE_URL\",\"statusUrl\":\"$STATUS_URL\"}"
done
CLUSTER_INSTANCES+="]"

# Build CouchDB node mapping
COUCHDB_NODE_MAPPING="{"
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    
    if [ $i -gt 0 ]; then
        COUCHDB_NODE_MAPPING+=","
    fi
    
    COUCHDB_NODE_MAPPING+="\"couchdb@couchdb$((i+1)).zombieauth\":\"$INSTANCE_NAME\""
done
COUCHDB_NODE_MAPPING+="}"

# Save all environment variables to .env file
cat > "$ENV_FILE" <<EOF
# ZombieAuth Development Environment
# Generated on: $(date)

# CouchDB Admin Credentials (shared across cluster)
COUCHDB_ADMIN_USER=$COUCHDB_ADMIN_USER
COUCHDB_ADMIN_PASSWORD=$COUCHDB_ADMIN_PASSWORD

# ZombieAuth Application User
ZOMBIEAUTH_USER=$ZOMBIEAUTH_USER
ZOMBIEAUTH_PASSWORD=$ZOMBIEAUTH_PASSWORD
COUCHDB_SECRET=$COUCHDB_SECRET
COUCHDB_COOKIE=$COUCHDB_COOKIE

# ZombieAuth Admin UI Credentials  
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Security Secrets
JWT_SECRET=$JWT_SECRET
SESSION_SECRET=$SESSION_SECRET
ADMIN_CLIENT_SECRET=$ADMIN_CLIENT_SECRET
DEFAULT_CLIENT_ID=$DEFAULT_CLIENT_ID

# Development Settings
ENABLE_TEST_ENDPOINTS=$ENABLE_TEST_ENDPOINTS
NODE_ENV=development

# Cluster Configuration
CLUSTER_INSTANCES=$CLUSTER_INSTANCES
COUCHDB_NODE_MAPPING=$COUCHDB_NODE_MAPPING
INSTANCE_COUNT=$INSTANCE_COUNT
INSTANCE_NAMES=$INSTANCE_NAMES
BASE_PORT=$BASE_PORT
COUCHDB_BASE_PORT=$COUCHDB_BASE_PORT
STATUS_BASE_PORT=$STATUS_BASE_PORT
EOF

# Create docker-compose.yml dynamically
echo ""
echo "📝 Creating docker-compose.yml..."

# Generate docker-compose.yml
cat > development/docker-compose.yml << EOF
version: '3.8'

services:
EOF

# Generate CouchDB services
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    COUCHDB_PORT=$((COUCHDB_BASE_PORT + i))
    
    cat >> development/docker-compose.yml << EOF
  # CouchDB Instance - $INSTANCE_NAME
  couchdb$((i+1)):
    image: couchdb:3.3
    container_name: zombieauth-couchdb$((i+1))
    environment:
      - COUCHDB_USER=$COUCHDB_ADMIN_USER
      - COUCHDB_PASSWORD=$COUCHDB_ADMIN_PASSWORD
      - COUCHDB_SECRET=$COUCHDB_SECRET
      - ERL_FLAGS=-setcookie $COUCHDB_COOKIE -name couchdb@couchdb$((i+1)).zombieauth -kernel inet_dist_listen_min 9100 -kernel inet_dist_listen_max 9200
    ports:
      - "$COUCHDB_PORT:5984"
    volumes:
      - couchdb$((i+1))_data:/opt/couchdb/data
    networks:
      zombieauth:
        aliases:
          - couchdb$((i+1)).zombieauth
    restart: unless-stopped

EOF
done

# Generate CouchDB Status services
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    STATUS_PORT=$((STATUS_BASE_PORT + i))
    
    cat >> development/docker-compose.yml << EOF
  # Cluster Status Service - $INSTANCE_NAME
  couchdb$((i+1))-status:
    image: ghcr.io/hodlontoyourbutts/cluster-status:latest
    container_name: zombieauth-couchdb$((i+1))-status
    environment:
      - PORT=3100
      - COUCHDB_URL=http://couchdb$((i+1)).zombieauth:5984
      - COUCHDB_ADMIN_USER=$COUCHDB_ADMIN_USER
      - COUCHDB_ADMIN_PASSWORD=$COUCHDB_ADMIN_PASSWORD
    ports:
      - "$STATUS_PORT:3100"
    networks:
      - zombieauth
    depends_on:
      - couchdb$((i+1))
    restart: unless-stopped

EOF
done

# Generate ZombieAuth OIDC and Admin services
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    OIDC_PORT=$((BASE_PORT + i))
    ADMIN_PORT=$((BASE_PORT + 1000 + i))  # Admin ports start at BASE_PORT + 1000
    
    # Build peer CouchDB URLs (all except the primary)
    PEER_URLS=""
    for j in "${!NAMES_ARRAY[@]}"; do
        if [ $j -ne $i ]; then
            if [ -n "$PEER_URLS" ]; then
                PEER_URLS+=","
            fi
            PEER_URLS+="http://couchdb$((j+1)).zombieauth:5984"
        fi
    done
    
    cat >> development/docker-compose.yml << EOF
  # ZombieAuth OIDC Instance - $INSTANCE_NAME
  zombieauth$((i+1)):
    build: ..
    container_name: zombieauth-$INSTANCE_NAME
    depends_on:
      - couchdb$((i+1))
    environment:
      - NODE_ENV=development
      - OIDC_PORT=8080
      - PORT=8080
      - INSTANCE_ID=$INSTANCE_NAME
      - INSTANCE_NAME=$INSTANCE_NAME
      - INSTANCE_LOCATION=$INSTANCE_NAME
      - PRIMARY_COUCHDB_URL=http://couchdb$((i+1)).zombieauth:5984
      - PEER_COUCHDB_URLS=$PEER_URLS
      - CLUSTER_INSTANCES=$CLUSTER_INSTANCES
      - COUCHDB_NODE_MAPPING=$COUCHDB_NODE_MAPPING
      - CLUSTER_STATUS_URL=http://couchdb$((i+1))-status:3100
      - COUCHDB_USER=$ZOMBIEAUTH_USER
      - COUCHDB_PASSWORD=$ZOMBIEAUTH_PASSWORD
      - COUCHDB_SECRET=$COUCHDB_SECRET
      - COUCHDB_DATABASE=zombieauth
      - ADMIN_USERNAME=$ADMIN_USERNAME
      - ADMIN_PASSWORD=$ADMIN_PASSWORD
      - JWT_SECRET=$JWT_SECRET
      - SESSION_SECRET=$SESSION_SECRET
      - ADMIN_CLIENT_SECRET=$ADMIN_CLIENT_SECRET
      - ENABLE_TEST_ENDPOINTS=$ENABLE_TEST_ENDPOINTS
      - ISSUER=http://localhost:$OIDC_PORT
      - DEFAULT_CLIENT_ID=$DEFAULT_CLIENT_ID
    ports:
      - "$OIDC_PORT:8080"
    volumes:
      - ..:/app
      - /app/node_modules
    networks:
      - zombieauth
    command: npm run start:oidc
    restart: unless-stopped

  # ZombieAuth Admin Instance - $INSTANCE_NAME
  zombieauth-admin$((i+1)):
    build: ..
    container_name: zombieauth-admin-$INSTANCE_NAME
    depends_on:
      - couchdb$((i+1))
    environment:
      - NODE_ENV=development
      - ADMIN_PORT=8080
      - PORT=8080
      - INSTANCE_ID=$INSTANCE_NAME
      - INSTANCE_NAME=$INSTANCE_NAME
      - INSTANCE_LOCATION=$INSTANCE_NAME
      - PRIMARY_COUCHDB_URL=http://couchdb$((i+1)).zombieauth:5984
      - PEER_COUCHDB_URLS=$PEER_URLS
      - CLUSTER_INSTANCES=$CLUSTER_INSTANCES
      - COUCHDB_NODE_MAPPING=$COUCHDB_NODE_MAPPING
      - CLUSTER_STATUS_URL=http://couchdb$((i+1))-status:3100
      - COUCHDB_USER=$ZOMBIEAUTH_USER
      - COUCHDB_PASSWORD=$ZOMBIEAUTH_PASSWORD
      - COUCHDB_SECRET=$COUCHDB_SECRET
      - COUCHDB_DATABASE=zombieauth
      - ADMIN_USERNAME=$ADMIN_USERNAME
      - ADMIN_PASSWORD=$ADMIN_PASSWORD
      - JWT_SECRET=$JWT_SECRET
      - SESSION_SECRET=$SESSION_SECRET
      - ADMIN_CLIENT_SECRET=$ADMIN_CLIENT_SECRET
      - ENABLE_TEST_ENDPOINTS=$ENABLE_TEST_ENDPOINTS
      - ISSUER=http://localhost:$OIDC_PORT
      - OIDC_INTERNAL_BASE_URL=http://zombieauth$((i+1)):8080
      - DEFAULT_CLIENT_ID=$DEFAULT_CLIENT_ID
    ports:
      - "$ADMIN_PORT:8080"
    volumes:
      - ..:/app
      - /app/node_modules
    networks:
      - zombieauth
    command: npm run start:admin
    restart: unless-stopped

EOF
done

# Add volumes and networks
cat >> development/docker-compose.yml << EOF

volumes:
EOF

for i in "${!NAMES_ARRAY[@]}"; do
    cat >> development/docker-compose.yml << EOF
  couchdb$((i+1))_data:
EOF
done

cat >> development/docker-compose.yml << EOF

networks:
  zombieauth:
    driver: bridge
EOF

echo "✅ docker-compose.yml created successfully in ./development/"
echo "✅ Environment variables saved to $ENV_FILE"
echo ""
echo "🔧 Generated Configuration:"
echo "=========================="
echo "Instances: $INSTANCE_COUNT (${NAMES_ARRAY[*]})"
echo "Database User: $ZOMBIEAUTH_USER"
echo "Admin Username: $ADMIN_USERNAME"
echo "Client ID: $DEFAULT_CLIENT_ID"
echo "Test Endpoints: $ENABLE_TEST_ENDPOINTS"
echo ""
echo "💾 Admin Login Credentials:"
echo "=========================="
echo "Username: $ADMIN_USERNAME"
echo "Password: $ADMIN_PASSWORD"
echo ""
echo "🌐 Service URLs:"
echo "==============="
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    OIDC_PORT=$((BASE_PORT + i))
    ADMIN_PORT=$((BASE_PORT + 1000 + i))
    COUCHDB_PORT=$((COUCHDB_BASE_PORT + i))
    STATUS_PORT=$((STATUS_BASE_PORT + i))
    echo "  $INSTANCE_NAME:"
    echo "    OIDC Endpoint: http://localhost:$OIDC_PORT"
    echo "    Admin Interface: http://localhost:$ADMIN_PORT"
    echo "    CouchDB: http://localhost:$COUCHDB_PORT/_utils"
    echo "    Status: http://localhost:$STATUS_PORT"
done
echo ""
echo "🚨 DEVELOPMENT REMINDERS:"
echo "========================="
echo "1. This is for DEVELOPMENT ONLY - use create-production.sh for production"
echo "2. Never commit development/docker-compose.yml to version control"
echo "3. All instances share the same admin credentials for simplicity"
echo "4. Test endpoints are enabled for development"
echo ""
echo "🔄 To regenerate with same settings:"
echo "  ./create-development.sh --env-file $ENV_FILE"
echo ""
echo "🔄 To regenerate with new secrets:"
echo "  ./create-development.sh --regenerate-secrets"
echo ""
echo "📋 Next Steps:"
echo "=============="
echo "1. Add development/docker-compose.yml to .gitignore if not already there"
echo "2. Start the services: cd development && docker-compose up -d"
echo "3. Or use: ./scripts/start-development.sh"
echo "4. Access any admin interface from the URLs above"
echo ""
echo "✅ Setup complete! Your ZombieAuth development cluster is ready to deploy."