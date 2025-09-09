#!/bin/bash

# Generate systemd quadlet files for ZombieAuth production deployment
# Usage: ./create-production.sh [options]
# Options:
#   --instances <count>           Number of instances (default: 3)
#   --names <name1,name2,...>     Instance names (comma-separated)
#   --domains <domain1,domain2>   FQDNs for each instance (comma-separated)
#   --couchdb-only               Generate only CouchDB quadlets
#   --zombieauth-only            Generate only ZombieAuth quadlets (requires existing CouchDB)
#   --output-dir <path>          Output directory (default: ./production)
#   --network <name>             Container network name (default: zombieauth)
#   --env-file <path>            Use existing .env file (default: ./production.env)
#   --regenerate-secrets         Force regeneration of secrets even if .env exists
#   --no-build                   Skip building container images
#   --help                       Show this help

set -e

# Default values
INSTANCE_COUNT=3
INSTANCE_NAMES=""
INSTANCE_DOMAINS=""
OUTPUT_DIR="./production"
GENERATE_COUCHDB=true
GENERATE_ZOMBIEAUTH=true
NETWORK_NAME="zombieauth"
ENV_FILE=""
REGENERATE_SECRETS=false
BUILD_IMAGES=true
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")/quadlets"

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
    --domains)
      INSTANCE_DOMAINS="$2"
      shift 2
      ;;
    --couchdb-only)
      GENERATE_ZOMBIEAUTH=false
      shift
      ;;
    --zombieauth-only)
      GENERATE_COUCHDB=false
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --network)
      NETWORK_NAME="$2"
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
    --no-build)
      BUILD_IMAGES=false
      shift
      ;;
    --help)
      head -15 "$0" | tail -13
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "🐳 Creating Quadlet files for ZombieAuth production cluster..."
echo "Instances: $INSTANCE_COUNT"
echo "Output Directory: $OUTPUT_DIR"
echo "Environment File: $ENV_FILE"
echo "Generate CouchDB: $GENERATE_COUCHDB"
echo "Generate ZombieAuth: $GENERATE_ZOMBIEAUTH"
echo "Network: $NETWORK_NAME"
echo "Build Images: $BUILD_IMAGES"
echo "=========================================="

# Check template directory exists
if [ ! -d "$TEMPLATE_DIR" ]; then
    echo "❌ Template directory not found: $TEMPLATE_DIR"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Set default ENV_FILE location if not specified
if [ -z "$ENV_FILE" ]; then
    ENV_FILE="$OUTPUT_DIR/production.env"
fi

# Function to generate a random string
generate_random_string() {
    local length=$1
    openssl rand -base64 $((length * 3 / 4)) | tr -d "=+/\n" | cut -c1-${length}
}

# Function to generate secure password
generate_password() {
    local length=${1:-16}
    openssl rand -base64 $((length * 3 / 4)) | tr -d "=+/\n" | cut -c1-${length}
}

# Load or generate secrets
if [ -f "$ENV_FILE" ] && [ "$REGENERATE_SECRETS" = false ]; then
    echo "📂 Loading existing secrets from $ENV_FILE..."
    source "$ENV_FILE"
    echo "✅ Loaded existing secrets"
else
    echo "🔐 Generating new secrets..."
    
    # Generate shared secrets (same across all instances)
    SHARED_COUCHDB_SECRET=$(generate_random_string 32)
    SHARED_COUCHDB_COOKIE=$(generate_random_string 24)
    SHARED_JWT_SECRET=$(openssl rand -base64 32)
    SHARED_SESSION_SECRET=$(openssl rand -base64 32)
    SHARED_ADMIN_CLIENT_SECRET=$(openssl rand -base64 32)
    SHARED_CLIENT_ID="client_$(openssl rand -hex 16)"

    # CouchDB admin credentials (shared across cluster)
    COUCHDB_ADMIN_USER="admin"
    COUCHDB_ADMIN_PASSWORD=$(generate_password 16)

    # ZombieAuth application user
    ZOMBIEAUTH_USER="zombieauth"
    ZOMBIEAUTH_PASSWORD=$(generate_password 16)
    
    # Admin user password
    ADMIN_PASSWORD=$(generate_password 16)
    
    # Save to .env file
    cat > "$ENV_FILE" << EOF
# ZombieAuth Quadlet Generation Variables
# Generated on: $(date)

# Shared secrets (same across all instances)
SHARED_COUCHDB_SECRET=$SHARED_COUCHDB_SECRET
SHARED_COUCHDB_COOKIE=$SHARED_COUCHDB_COOKIE
SHARED_JWT_SECRET=$SHARED_JWT_SECRET
SHARED_SESSION_SECRET=$SHARED_SESSION_SECRET
SHARED_ADMIN_CLIENT_SECRET=$SHARED_ADMIN_CLIENT_SECRET
SHARED_CLIENT_ID=$SHARED_CLIENT_ID

# Database credentials
COUCHDB_ADMIN_USER=$COUCHDB_ADMIN_USER
COUCHDB_ADMIN_PASSWORD=$COUCHDB_ADMIN_PASSWORD
ZOMBIEAUTH_USER=$ZOMBIEAUTH_USER
ZOMBIEAUTH_PASSWORD=$ZOMBIEAUTH_PASSWORD

# Admin user credentials
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
    
    echo "✅ Generated and saved secrets to $ENV_FILE"
fi

# Override instance configuration if provided via command line
if [ -n "$INSTANCE_NAMES" ]; then
    IFS=',' read -ra NAMES_ARRAY <<< "$INSTANCE_NAMES"
    INSTANCE_COUNT=${#NAMES_ARRAY[@]}
    # Save to .env file
    echo "INSTANCE_NAMES=$INSTANCE_NAMES" >> "$ENV_FILE"
    echo "INSTANCE_COUNT=$INSTANCE_COUNT" >> "$ENV_FILE"
elif grep -q "INSTANCE_NAMES=" "$ENV_FILE" 2>/dev/null; then
    # Load from .env file
    INSTANCE_NAMES=$(grep "INSTANCE_NAMES=" "$ENV_FILE" | cut -d'=' -f2)
    INSTANCE_COUNT=$(grep "INSTANCE_COUNT=" "$ENV_FILE" | cut -d'=' -f2)
    IFS=',' read -ra NAMES_ARRAY <<< "$INSTANCE_NAMES"
else
    # Generate default names
    echo "📝 Generating default instance names..."
    NAMES_ARRAY=()
    for i in $(seq 1 $INSTANCE_COUNT); do
        NAMES_ARRAY+=("node$i")
    done
    INSTANCE_NAMES=$(IFS=','; echo "${NAMES_ARRAY[*]}")
    # Save to .env file
    echo "INSTANCE_NAMES=$INSTANCE_NAMES" >> "$ENV_FILE"
    echo "INSTANCE_COUNT=$INSTANCE_COUNT" >> "$ENV_FILE"
fi

# Handle domains similarly
if [ -n "$INSTANCE_DOMAINS" ]; then
    IFS=',' read -ra DOMAINS_ARRAY <<< "$INSTANCE_DOMAINS"
    if [ ${#DOMAINS_ARRAY[@]} -ne $INSTANCE_COUNT ]; then
        echo "❌ Number of domains (${#DOMAINS_ARRAY[@]}) must match number of instances ($INSTANCE_COUNT)"
        exit 1
    fi
    # Save to .env file
    echo "INSTANCE_DOMAINS=$INSTANCE_DOMAINS" >> "$ENV_FILE"
elif grep -q "INSTANCE_DOMAINS=" "$ENV_FILE" 2>/dev/null; then
    # Load from .env file
    INSTANCE_DOMAINS=$(grep "INSTANCE_DOMAINS=" "$ENV_FILE" | cut -d'=' -f2)
    IFS=',' read -ra DOMAINS_ARRAY <<< "$INSTANCE_DOMAINS"
else
    # Generate default domains
    DOMAINS_ARRAY=()
    for INSTANCE_NAME in "${NAMES_ARRAY[@]}"; do
        DOMAINS_ARRAY+=("auth-${INSTANCE_NAME}.example.com")
    done
    INSTANCE_DOMAINS=$(IFS=','; echo "${DOMAINS_ARRAY[*]}")
    # Save to .env file
    echo "INSTANCE_DOMAINS=$INSTANCE_DOMAINS" >> "$ENV_FILE"
fi

echo "Instance names: ${NAMES_ARRAY[*]}"
echo "Instance domains: ${DOMAINS_ARRAY[*]}"

# Build cluster configuration JSON
echo "🔧 Building cluster configuration..."
CLUSTER_INSTANCES="["
COUCHDB_NODE_MAPPING="{"

for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    DOMAIN="${DOMAINS_ARRAY[$i]}"
    STATUS_DOMAIN="status-${INSTANCE_NAME}.$(echo $DOMAIN | cut -d'.' -f2-)"
    
    # Build instance entry
    if [ $i -gt 0 ]; then
        CLUSTER_INSTANCES+=","
        COUCHDB_NODE_MAPPING+=","
    fi
    
    DISPLAY_NAME="$(echo $INSTANCE_NAME | sed 's/./\U&/' | sed 's/_/ /g')"
    BASE_URL="http://${DOMAIN}"
    STATUS_URL="http://${STATUS_DOMAIN}"
    
    CLUSTER_INSTANCES+="{\"id\":\"$INSTANCE_NAME\",\"name\":\"$DISPLAY_NAME\",\"baseUrl\":\"$BASE_URL\",\"statusUrl\":\"$STATUS_URL\"}"
    COUCHDB_NODE_MAPPING+="\"couchdb@${INSTANCE_NAME}.local\":\"$INSTANCE_NAME\""
done

CLUSTER_INSTANCES+="]"
COUCHDB_NODE_MAPPING+="}"

# Build ALLOWED_ORIGINS from all instance domains
ALLOWED_ORIGINS=""
for i in "${!NAMES_ARRAY[@]}"; do
    DOMAIN="${DOMAINS_ARRAY[$i]}"
    if [ -n "$ALLOWED_ORIGINS" ]; then
        ALLOWED_ORIGINS+=","
    fi
    ALLOWED_ORIGINS+="http://$DOMAIN"
done

# Save cluster config to .env file
grep -v -E "(CLUSTER_INSTANCES=|COUCHDB_NODE_MAPPING=|ALLOWED_ORIGINS=)" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || touch "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "CLUSTER_INSTANCES=$CLUSTER_INSTANCES" >> "$ENV_FILE"
echo "COUCHDB_NODE_MAPPING=$COUCHDB_NODE_MAPPING" >> "$ENV_FILE"
echo "ALLOWED_ORIGINS=$ALLOWED_ORIGINS" >> "$ENV_FILE"

# Build container images if requested
if [ "$BUILD_IMAGES" = true ]; then
    echo "🔨 Building production container images..."
    
    # Detect container engine
    if command -v podman > /dev/null 2>&1; then
        CONTAINER_CMD="podman"
    elif command -v docker > /dev/null 2>&1; then
        CONTAINER_CMD="docker"
    else
        echo "❌ No container engine found (podman or docker required)"
        exit 1
    fi
    
    echo "Using container engine: $CONTAINER_CMD"
    
    # Build main ZombieAuth image
    if [ "$GENERATE_ZOMBIEAUTH" = true ]; then
        echo "   Building zombieauth:latest..."
        cd "$PROJECT_DIR"
        $CONTAINER_CMD build -t localhost/zombieauth:latest -f Dockerfile .
        echo "✅ Built localhost/zombieauth:latest"
    fi
    
    # Build cluster status image if it exists
    if [ "$GENERATE_ZOMBIEAUTH" = true ] && [ -f "$PROJECT_DIR/cluster-status-service/Dockerfile" ]; then
        echo "   Building zombieauth-cluster-status:latest..."
        cd "$PROJECT_DIR/cluster-status-service"
        $CONTAINER_CMD build -t localhost/zombieauth-cluster-status:latest .
        echo "✅ Built localhost/zombieauth-cluster-status:latest"
    elif [ "$GENERATE_ZOMBIEAUTH" = true ]; then
        echo "⚠️  cluster-status-service/Dockerfile not found - you'll need to build the status image manually"
    fi
    
    cd "$SCRIPT_DIR"
    echo "✅ Container image building complete!"
fi

# Note: Network quadlet creation skipped - create manually if needed
# Example network file ($NETWORK_NAME.network):
#   [Network]
#   NetworkName=$NETWORK_NAME
#   Driver=bridge

# Template substitution function
substitute_template() {
    local template_file="$1"
    local output_file="$2"
    local instance_name="$3"
    local domain="$4"
    local status_domain="$5"
    
    sed -e "s|__INSTANCE_ID__|$instance_name|g" \
        -e "s|__INSTANCE_NAME__|$instance_name|g" \
        -e "s|__INSTANCE_DISPLAY_NAME__|$(echo $instance_name | sed 's/./\U&/' | sed 's/_/ /g')|g" \
        -e "s|__INSTANCE_LOCATION__|$instance_name|g" \
        -e "s|__FQDN__|$domain|g" \
        -e "s|__OIDC_FQDN__|$domain|g" \
        -e "s|__ADMIN_FQDN__|$domain|g" \
        -e "s|__STATUS_FQDN__|$status_domain|g" \
        -e "s|__NETWORK_NAME__|$NETWORK_NAME|g" \
        -e "s|__PRIMARY_COUCHDB_URL__|http://couchdb:5984|g" \
        -e "s|__COUCHDB_INTERNAL_URL__|http://couchdb:5984|g" \
        -e "s|__COUCHDB_NODE_NAME__|${instance_name}.local|g" \
        -e "s|__ISSUER_URL__|http://$domain|g" \
        -e "s|__STATUS_URL__|http://couchdb-status|g" \
        -e "s|__CLUSTER_INSTANCES__|$CLUSTER_INSTANCES|g" \
        -e "s|__COUCHDB_NODE_MAPPING__|$COUCHDB_NODE_MAPPING|g" \
        -e "s|__COUCHDB_ADMIN_USER__|$COUCHDB_ADMIN_USER|g" \
        -e "s|__COUCHDB_ADMIN_PASSWORD__|$COUCHDB_ADMIN_PASSWORD|g" \
        -e "s|__ZOMBIEAUTH_USER__|$ZOMBIEAUTH_USER|g" \
        -e "s|__ZOMBIEAUTH_PASSWORD__|$ZOMBIEAUTH_PASSWORD|g" \
        -e "s|__ADMIN_PASSWORD__|$ADMIN_PASSWORD|g" \
        -e "s|__SHARED_COUCHDB_SECRET__|$SHARED_COUCHDB_SECRET|g" \
        -e "s|__SHARED_COUCHDB_COOKIE__|$SHARED_COUCHDB_COOKIE|g" \
        -e "s|__SHARED_JWT_SECRET__|$SHARED_JWT_SECRET|g" \
        -e "s|__SHARED_SESSION_SECRET__|$SHARED_SESSION_SECRET|g" \
        -e "s|__SHARED_ADMIN_CLIENT_SECRET__|$SHARED_ADMIN_CLIENT_SECRET|g" \
        -e "s|__SHARED_CLIENT_ID__|$SHARED_CLIENT_ID|g" \
        -e "s|__ALLOWED_ORIGINS__|$ALLOWED_ORIGINS|g" \
        -e "s|__COUCHDB_DEPENDENCY__|$([ "$GENERATE_COUCHDB" = true ] && echo "Requires=couchdb.service" || echo "# Requires=couchdb.service")|g" \
        "$template_file" > "$output_file"
}

# Generate deployment directories for each instance
for i in "${!NAMES_ARRAY[@]}"; do
    INSTANCE_NAME="${NAMES_ARRAY[$i]}"
    DOMAIN="${DOMAINS_ARRAY[$i]}"
    STATUS_DOMAIN="status-${INSTANCE_NAME}.$(echo $DOMAIN | cut -d'.' -f2-)"
    
    echo "📦 Generating quadlets for instance: $INSTANCE_NAME"
    
    # Create instance directory
    INSTANCE_DIR="$OUTPUT_DIR/$INSTANCE_NAME"
    mkdir -p "$INSTANCE_DIR"
    
    # Generate CouchDB quadlet
    if [ "$GENERATE_COUCHDB" = true ]; then
        substitute_template "$TEMPLATE_DIR/couchdb.default" "$INSTANCE_DIR/couchdb.container" "$INSTANCE_NAME" "$DOMAIN" "$STATUS_DOMAIN"
    fi
    
    # Generate CouchDB Status Service quadlet
    if [ "$GENERATE_ZOMBIEAUTH" = true ]; then
        substitute_template "$TEMPLATE_DIR/couchdb-status.default" "$INSTANCE_DIR/couchdb-status.container" "$INSTANCE_NAME" "$DOMAIN" "$STATUS_DOMAIN"
    fi
    
    # Generate ZombieAuth OIDC and Admin quadlets
    if [ "$GENERATE_ZOMBIEAUTH" = true ]; then
        substitute_template "$TEMPLATE_DIR/zombieauth.default" "$INSTANCE_DIR/zombieauth.container" "$INSTANCE_NAME" "$DOMAIN" "$STATUS_DOMAIN"
        substitute_template "$TEMPLATE_DIR/zombieauth-admin.default" "$INSTANCE_DIR/zombieauth-admin.container" "$INSTANCE_NAME" "$DOMAIN" "$STATUS_DOMAIN"
    fi
    
    # Generate instance deployment script
    cat > "$INSTANCE_DIR/deploy.sh" << EOF
#!/bin/bash
# Deploy ZombieAuth instance: $INSTANCE_NAME

set -e

echo "🚀 Deploying $INSTANCE_NAME to /etc/containers/systemd/"

# Create host directories and set permissions
echo "📁 Creating host directories..."
EOF

# Add directory creation commands conditionally
if [ "$GENERATE_COUCHDB" = true ]; then
    cat >> "$INSTANCE_DIR/deploy.sh" << EOF
sudo mkdir -p /opt/couchdb/opt-couchdb-data
EOF
fi

if [ "$GENERATE_ZOMBIEAUTH" = true ]; then
    cat >> "$INSTANCE_DIR/deploy.sh" << EOF
sudo mkdir -p /opt/zombieauth/etc-zombieauth
sudo mkdir -p /opt/zombieauth/tmp
sudo mkdir -p /opt/zombieauth/var-log
EOF
fi

cat >> "$INSTANCE_DIR/deploy.sh" << EOF

# Copy quadlet files
sudo cp *.container /etc/containers/systemd/

# Reload systemd
sudo systemctl daemon-reload

echo "✅ $INSTANCE_NAME quadlets deployed"
echo ""
echo "🔧 Start services:"
$([ "$GENERATE_COUCHDB" = true ] && echo "sudo systemctl start couchdb.service")
$([ "$GENERATE_ZOMBIEAUTH" = true ] && echo "sudo systemctl start couchdb-status.service")
$([ "$GENERATE_ZOMBIEAUTH" = true ] && echo "sudo systemctl start zombieauth.service")
$([ "$GENERATE_ZOMBIEAUTH" = true ] && echo "sudo systemctl start zombieauth-admin.service")
echo ""
echo "🔧 Enable auto-start:"
$([ "$GENERATE_COUCHDB" = true ] && echo "sudo systemctl enable couchdb.service")
$([ "$GENERATE_ZOMBIEAUTH" = true ] && echo "sudo systemctl enable couchdb-status.service")
$([ "$GENERATE_ZOMBIEAUTH" = true ] && echo "sudo systemctl enable zombieauth.service")
$([ "$GENERATE_ZOMBIEAUTH" = true ] && echo "sudo systemctl enable zombieauth-admin.service")
echo ""
echo "📡 Service URLs:"
echo "  OIDC Endpoint: Configure in Traefik for your SSO domain"
echo "  Admin Interface: Configure in Traefik for your admin domain"
echo "  CouchDB Status: http://$STATUS_DOMAIN"
EOF
    chmod +x "$INSTANCE_DIR/deploy.sh"
done

# Note: ENV_FILE is already in the output directory

echo ""
echo "✅ Quadlet generation complete!"
echo "📁 Files created in: $OUTPUT_DIR"
echo "📄 Configuration saved in: $ENV_FILE"
echo ""
echo "🔄 To regenerate with same settings:"
echo "  ./create-production.sh --env-file $ENV_FILE"
echo ""
echo "🔄 To regenerate with new secrets:"
echo "  ./create-production.sh --regenerate-secrets"
echo ""
echo "🔐 Current Configuration:"
echo "========================"
echo "Client ID: $SHARED_CLIENT_ID"
echo "Instances: ${NAMES_ARRAY[*]}"
echo "Domains: ${DOMAINS_ARRAY[*]}"