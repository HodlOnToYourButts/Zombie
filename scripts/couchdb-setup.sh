#!/bin/bash
set -e

echo "🚀 Setting up CouchDB for Zombie..."

# Get configuration from environment variables
COUCHDB_URL=${COUCHDB_URL:-"http://couchdb:5984"}
ADMIN_USER=${COUCHDB_ZOMBIEAUTH_USER:-"admin"}
ADMIN_PASSWORD=${COUCHDB_ZOMBIEAUTH_PASSWORD:-"admin"}
DB_NAME=${COUCHDB_DATABASE:-"zombieauth"}
APP_USER=${COUCHDB_USER:-"zombieauth"}
APP_PASSWORD=${COUCHDB_PASSWORD:-"admin"}

echo "CouchDB URL: $COUCHDB_URL"
echo "Database: $DB_NAME"
echo "Application User: $APP_USER"

# Wait for CouchDB to be ready
echo "⏳ Waiting for CouchDB to be ready..."
until curl -f -s "$COUCHDB_URL" > /dev/null; do
  echo "CouchDB not ready, waiting..."
  sleep 2
done

echo "✅ CouchDB is ready"

# Create database
echo "📁 Creating database: $DB_NAME"
curl -s -X PUT -u "$ADMIN_USER:$ADMIN_PASSWORD" "$COUCHDB_URL/$DB_NAME" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  Database already exists"
  else
    echo "❌ Failed to create database"
    exit 1
  fi
}

# Create user
echo "👤 Creating database user: $APP_USER"
USER_DOC="{
  \"_id\": \"org.couchdb.user:$APP_USER\",
  \"name\": \"$APP_USER\",
  \"type\": \"user\",
  \"roles\": [],
  \"password\": \"$APP_PASSWORD\"
}"

curl -s -X POST -u "$ADMIN_USER:$ADMIN_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$USER_DOC" \
     "$COUCHDB_URL/_users" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  Database user already exists"
  else
    echo "❌ Failed to create database user"
    exit 1
  fi
}

# Set permissions
echo "🔐 Setting database permissions..."
SECURITY_DOC="{
  \"members\": {
    \"names\": [\"$APP_USER\"],
    \"roles\": []
  }
}"

curl -s -X PUT -u "$ADMIN_USER:$ADMIN_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$SECURITY_DOC" \
     "$COUCHDB_URL/$DB_NAME/_security"

echo "✅ CouchDB setup completed successfully!"