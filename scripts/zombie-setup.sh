#!/bin/sh
set -e

echo "🧟 Setting up Zombie application database..."

# Get configuration from environment variables
COUCHDB_URL=${COUCHDB_URL:-"http://couchdb:5984"}
COUCHDB_ADMIN_USER=${COUCHDB_ADMIN_USER:-"admin"}
COUCHDB_ADMIN_PASSWORD=${COUCHDB_ADMIN_PASSWORD:-"admin"}
DB_NAME=${COUCHDB_DATABASE:-"zombie"}
APP_USER=${COUCHDB_USER:-"zombie"}
APP_PASSWORD=${COUCHDB_PASSWORD}

if [ -z "$APP_PASSWORD" ]; then
    echo "❌ COUCHDB_PASSWORD environment variable must be set"
    exit 1
fi

echo "CouchDB URL: $COUCHDB_URL"
echo "Database: $DB_NAME"
echo "Application User: $APP_USER"

# Wait for CouchDB and _users database to be ready
echo "⏳ Waiting for CouchDB and _users database to be ready..."
until curl -f -s -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" "$COUCHDB_URL/_users" > /dev/null; do
    echo "CouchDB _users database not ready, waiting..."
    sleep 5
done

echo "✅ CouchDB infrastructure is ready"

# Create Zombie application database
echo "📁 Creating Zombie database: $DB_NAME"
curl -s -X PUT -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" "$COUCHDB_URL/$DB_NAME" || {
  if [ $? -eq 22 ]; then
    echo "ℹ️  Database already exists"
  else
    echo "❌ Failed to create database"
    exit 1
  fi
}

# Create Zombie application user
echo "👤 Creating Zombie application user: $APP_USER"
USER_DOC="{
  \"_id\": \"org.couchdb.user:$APP_USER\",
  \"name\": \"$APP_USER\",
  \"type\": \"user\",
  \"roles\": [],
  \"password\": \"$APP_PASSWORD\"
}"

curl -s -X POST -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" \
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

# Set database permissions (make app user admin of its own database)
echo "🔐 Setting database permissions..."
SECURITY_DOC="{
  \"members\": {
    \"names\": [\"$APP_USER\"],
    \"roles\": []
  },
  \"admins\": {
    \"names\": [\"$APP_USER\"],
    \"roles\": []
  }
}"

curl -s -X PUT -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$SECURITY_DOC" \
     "$COUCHDB_URL/$DB_NAME/_security"

echo "✅ Database and user setup completed. Now switching to app user for Zombie-specific setup..."

# From here on, use app user credentials for all operations
# Wait for app user to be able to access the database
echo "⏳ Waiting for app user access to be ready..."
until curl -f -s -u "$APP_USER:$APP_PASSWORD" "$COUCHDB_URL/$DB_NAME" > /dev/null; do
    echo "App user access not ready, waiting..."
    sleep 2
done

echo "✅ App user access confirmed"

# Create design documents for views and indexes
echo "📋 Creating design documents..."

# Create users view
echo "👥 Creating users design document..."
USERS_DESIGN_DOC='{
    "_id": "_design/users",
    "views": {
        "by_username": {
            "map": "function(doc) { if (doc.type === \"user\" && doc.username) { emit(doc.username, doc); } }"
        },
        "by_email": {
            "map": "function(doc) { if (doc.type === \"user\" && doc.email) { emit(doc.email, doc); } }"
        },
        "by_role": {
            "map": "function(doc) { if (doc.type === \"user\" && doc.roles) { doc.roles.forEach(function(role) { emit(role, doc); }); } }"
        }
    }
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$USERS_DESIGN_DOC" \
     "$COUCHDB_URL/$DB_NAME/_design/users" || {
    echo "ℹ️  Users design document may already exist"
}

# Create sessions view
echo "🎫 Creating sessions design document..."
SESSIONS_DESIGN_DOC='{
    "_id": "_design/sessions",
    "views": {
        "by_user": {
            "map": "function(doc) { if (doc.type === \"session\" && doc.user_id) { emit(doc.user_id, doc); } }"
        },
        "by_user_id": {
            "map": "function(doc) { if (doc.type === \"session\" && doc.user_id) { emit(doc.user_id, doc); } }"
        },
        "by_expiry": {
            "map": "function(doc) { if (doc.type === \"session\" && doc.expires_at) { emit(doc.expires_at, doc); } }"
        },
        "by_auth_code": {
            "map": "function(doc) { if (doc.type === \"session\" && doc.authorization_code) { emit(doc.authorization_code, doc); } }"
        },
        "active": {
            "map": "function(doc) { if (doc.type === \"session\" && doc.expires_at && new Date(doc.expires_at) > new Date()) { emit(doc._id, doc); } }"
        }
    }
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$SESSIONS_DESIGN_DOC" \
     "$COUCHDB_URL/$DB_NAME/_design/sessions" || {
    echo "ℹ️  Sessions design document may already exist"
}

# Create clients view
echo "🔧 Creating clients design document..."
CLIENTS_DESIGN_DOC='{
    "_id": "_design/clients",
    "views": {
        "by_client_id": {
            "map": "function(doc) { if (doc.type === \"client\" && doc.client_id) { emit(doc.client_id, doc); } }"
        },
        "by_type": {
            "map": "function(doc) { if (doc.type === \"client\" && doc.grant_types) { doc.grant_types.forEach(function(type) { emit(type, doc); }); } }"
        }
    }
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$CLIENTS_DESIGN_DOC" \
     "$COUCHDB_URL/$DB_NAME/_design/clients" || {
    echo "ℹ️  Clients design document may already exist"
}

# Create authorization codes view
echo "🎟️ Creating authorization codes design document..."
AUTH_CODES_DESIGN_DOC='{
    "_id": "_design/auth_codes",
    "views": {
        "by_code": {
            "map": "function(doc) { if (doc.type === \"auth_code\" && doc.code) { emit(doc.code, doc); } }"
        },
        "by_client": {
            "map": "function(doc) { if (doc.type === \"auth_code\" && doc.client_id) { emit(doc.client_id, doc); } }"
        },
        "by_expiry": {
            "map": "function(doc) { if (doc.type === \"auth_code\" && doc.expires_at) { emit(doc.expires_at, doc); } }"
        }
    }
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$AUTH_CODES_DESIGN_DOC" \
     "$COUCHDB_URL/$DB_NAME/_design/auth_codes" || {
    echo "ℹ️  Authorization codes design document may already exist"
}

# Create refresh tokens view
echo "🔄 Creating refresh tokens design document..."
REFRESH_TOKENS_DESIGN_DOC='{
    "_id": "_design/refresh_tokens",
    "views": {
        "by_token": {
            "map": "function(doc) { if (doc.type === \"refresh_token\" && doc.token) { emit(doc.token, doc); } }"
        },
        "by_user": {
            "map": "function(doc) { if (doc.type === \"refresh_token\" && doc.user_id) { emit(doc.user_id, doc); } }"
        },
        "by_client": {
            "map": "function(doc) { if (doc.type === \"refresh_token\" && doc.client_id) { emit(doc.client_id, doc); } }"
        }
    }
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$REFRESH_TOKENS_DESIGN_DOC" \
     "$COUCHDB_URL/$DB_NAME/_design/refresh_tokens" || {
    echo "ℹ️  Refresh tokens design document may already exist"
}

# Create instance metadata view for multi-instance support
echo "🌐 Creating instance metadata design document..."
INSTANCE_DESIGN_DOC='{
    "_id": "_design/instances",
    "views": {
        "by_instance_id": {
            "map": "function(doc) { if (doc.instanceId) { emit(doc.instanceId, doc); } }"
        },
        "conflicts": {
            "map": "function(doc) { if (doc._conflicts) { emit(doc._id, doc); } }"
        },
        "by_modified": {
            "map": "function(doc) { if (doc.modifiedAt) { emit(doc.modifiedAt, doc); } }"
        }
    }
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$INSTANCE_DESIGN_DOC" \
     "$COUCHDB_URL/$DB_NAME/_design/instances" || {
    echo "ℹ️  Instance metadata design document may already exist"
}

# Create indexes for better query performance
echo "📊 Creating database indexes..."

# Index for user lookups
USER_INDEX='{
    "index": {
        "fields": ["type", "username"]
    },
    "name": "user-username-index",
    "type": "json"
}'

curl -s -X POST -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$USER_INDEX" \
     "$COUCHDB_URL/$DB_NAME/_index" || {
    echo "ℹ️  User username index may already exist"
}

# Index for session lookups
SESSION_INDEX='{
    "index": {
        "fields": ["type", "user_id", "expires_at"]
    },
    "name": "session-user-expiry-index",
    "type": "json"
}'

curl -s -X POST -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$SESSION_INDEX" \
     "$COUCHDB_URL/$DB_NAME/_index" || {
    echo "ℹ️  Session index may already exist"
}

# Index for client lookups
CLIENT_INDEX='{
    "index": {
        "fields": ["type", "client_id"]
    },
    "name": "client-id-index",
    "type": "json"
}'

curl -s -X POST -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$CLIENT_INDEX" \
     "$COUCHDB_URL/$DB_NAME/_index" || {
    echo "ℹ️  Client index may already exist"
}

echo "🏠 Creating application metadata document..."
APP_METADATA='{
    "_id": "app:metadata",
    "type": "app_metadata",
    "version": "0.1.0",
    "name": "zombie",
    "description": "Still authenticating when everything else is dead.",
    "setupDate": "'$(date -Iseconds)'",
    "instanceId": "'${INSTANCE_ID:-default}'"
}'

curl -s -X PUT -u "$APP_USER:$APP_PASSWORD" \
     -H "Content-Type: application/json" \
     -d "$APP_METADATA" \
     "$COUCHDB_URL/$DB_NAME/app:metadata" || {
    echo "ℹ️  Application metadata may already exist"
}

echo
echo "✅ Zombie database setup completed successfully!"
echo
echo "📋 Created:"
echo "  - Database: $DB_NAME"
echo "  - Application user: $APP_USER (with admin access to $DB_NAME only)"
echo "  - Security restrictions (only $APP_USER can access $DB_NAME)"
echo
echo "📋 Created design documents for:"
echo "  - Users (by username, email, role)"
echo "  - Sessions (by user, expiry, active)"
echo "  - Clients (by client_id, type)"
echo "  - Authorization codes (by code, client, expiry)"
echo "  - Refresh tokens (by token, user, client)"
echo "  - Instance metadata (by instance_id, conflicts, modified)"
echo
echo "📊 Created indexes for:"
echo "  - User username lookups"
echo "  - Session user/expiry lookups"
echo "  - Client ID lookups"
echo
echo "🏠 Created application metadata document"
echo
echo "🚀 Zombie is ready to authenticate!"