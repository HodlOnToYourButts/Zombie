#!/bin/bash

# Minimal CouchDB Setup Script for ZombieAuth
# Creates database and application user so main app doesn't need admin credentials

set -e

echo "🚀 ZombieAuth CouchDB Setup"
echo "=========================="
echo

# Get configuration from environment or use defaults  
COUCHDB_URL=${COUCHDB_URL:-"http://localhost:5984"}
DB_NAME=${COUCHDB_DATABASE:-"zombieauth"}
APP_USER=${COUCHDB_USER:-"zombieauth"}

echo "CouchDB URL: $COUCHDB_URL"
echo "Database: $DB_NAME"
echo "Application User: $APP_USER"
echo

# Prompt for admin credentials (not stored)
read -p "CouchDB Admin Username: " ADMIN_USER
read -s -p "CouchDB Admin Password: " ADMIN_PASSWORD
echo
echo

# Prompt for application database password
read -s -p "Application Database Password: " APP_PASSWORD
echo
echo

echo "⏳ Testing CouchDB connection..."
if ! curl -s --fail -u "$ADMIN_USER:$ADMIN_PASSWORD" "$COUCHDB_URL" > /dev/null; then
    echo "❌ Failed to connect to CouchDB. Please check your credentials and URL."
    exit 1
fi
echo "✅ CouchDB connection successful"

echo "📁 Creating database: $DB_NAME"
curl -s -X PUT -u "$ADMIN_USER:$ADMIN_PASSWORD" "$COUCHDB_URL/$DB_NAME" || {
    if [ $? -eq 22 ]; then  # HTTP error (likely 412 - database exists)
        echo "ℹ️  Database already exists"
    else
        echo "❌ Failed to create database"
        exit 1
    fi
}

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
    if [ $? -eq 22 ]; then  # HTTP error (likely 409 - user exists)
        echo "ℹ️  Database user already exists"
    else
        echo "❌ Failed to create database user"
        exit 1
    fi
}

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

echo
echo "✅ CouchDB setup completed successfully!"
echo
echo "📋 Environment variables for your application:"
echo "COUCHDB_USER=$APP_USER"
echo "COUCHDB_PASSWORD=$APP_PASSWORD"
echo "COUCHDB_DATABASE=$DB_NAME"
echo "COUCHDB_URL=$COUCHDB_URL"
echo
echo "📝 Next steps:"
echo "1. Add the environment variables above to your .env file"
echo "2. Use zombieauth-admin to create clients and users"
echo "3. Start your ZombieAuth application"