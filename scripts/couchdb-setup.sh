#!/bin/sh
set -e

echo "🚀 Setting up CouchDB infrastructure..."

# Get configuration from environment variables
COUCHDB_URL=${COUCHDB_URL:-"http://couchdb:5984"}
COUCHDB_ADMIN_USER=${COUCHDB_ADMIN_USER:-"admin"}
COUCHDB_ADMIN_PASSWORD=${COUCHDB_ADMIN_PASSWORD:-"admin"}

echo "CouchDB URL: $COUCHDB_URL"
echo "Admin User: $COUCHDB_ADMIN_USER"

# Wait for CouchDB to be ready
echo "⏳ Waiting for CouchDB to be ready..."
until curl -f -s "$COUCHDB_URL" > /dev/null; do
  echo "CouchDB not ready, waiting..."
  sleep 2
done

echo "✅ CouchDB is ready"

# Test admin credentials
echo "🔐 Testing admin credentials..."
if ! curl -s --fail -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" "$COUCHDB_URL" > /dev/null; then
    echo "❌ Failed to authenticate with CouchDB admin credentials"
    exit 1
fi
echo "✅ Admin authentication successful"

# Create _users database (required for user management)
echo "👥 Creating _users database..."
curl -s -X PUT -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" "$COUCHDB_URL/_users" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  _users database already exists"
  else
    echo "❌ Failed to create _users database"
    exit 1
  fi
}

# Create _replicator database (required for replication)
echo "🔄 Creating _replicator database..."
curl -s -X PUT -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" "$COUCHDB_URL/_replicator" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  _replicator database already exists"
  else
    echo "❌ Failed to create _replicator database"
    exit 1
  fi
}

# Create _global_changes database (required for global changes feed)
echo "🌐 Creating _global_changes database..."
curl -s -X PUT -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" "$COUCHDB_URL/_global_changes" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  _global_changes database already exists"
  else
    echo "❌ Failed to create _global_changes database"
    exit 1
  fi
}

# Create Zombie application database
echo "📁 Creating Zombie database: zombie"
curl -s -X PUT -u "$COUCHDB_USER:$COUCHDB_PASSWORD" "$COUCHDB_URL/zombie" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  Database already exists"
  else
    echo "❌ Failed to create database"
    exit 1
  fi
}

# Create Zombie application user
echo "👤 Creating Zombie application user: ${COUCHDB_APP_USER:-zombie}"
USER_DOC="{
  \"_id\": \"org.couchdb.user:${COUCHDB_APP_USER:-zombie}\",
  \"name\": \"${COUCHDB_APP_USER:-zombie}\",
  \"type\": \"user\",
  \"roles\": [],
  \"password\": \"${COUCHDB_APP_PASSWORD:-zombie}\"
}"

curl -s -X POST -u "$COUCHDB_USER:$COUCHDB_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$USER_DOC" \
     "$COUCHDB_URL/_users" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  Application user already exists"
  else
    echo "❌ Failed to create application user"
    exit 1
  fi
}

# Set database permissions (make zombie user admin of zombie database only)
echo "🔐 Setting database permissions..."
SECURITY_DOC="{
  \"members\": {
    \"names\": [\"${COUCHDB_APP_USER:-zombie}\"],
    \"roles\": []
  },
  \"admins\": {
    \"names\": [\"${COUCHDB_APP_USER:-zombie}\"],
    \"roles\": []
  }
}"

curl -s -X PUT -u "$COUCHDB_USER:$COUCHDB_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$SECURITY_DOC" \
     "$COUCHDB_URL/zombie/_security"

echo
echo "✅ CouchDB infrastructure setup completed successfully!"
echo
echo "📋 Created system databases:"
echo "  - _users (user management)"
echo "  - _replicator (replication jobs)"
echo "  - _global_changes (global changes feed)"
echo
echo "📋 Created application database:"
echo "  - zombie (with zombie user as admin)"
echo
echo "📝 Next step: Run zombie-setup to create application-specific database structure"