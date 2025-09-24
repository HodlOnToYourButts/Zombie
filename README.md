# Zombie

Still authenticating when everything else is dead.

## Overview

Zombie is a lightweight OAuth2/OpenID Connect authentication server that provides authentication services with a focus on simplicity and reliability. Built with CouchDB as the backend, it supports distributed deployments with active-active replication where each instance can operate independently.

## Key Features

- **🔐 OAuth2 & OpenID Connect**: Full compliance with OAuth2 and OpenID Connect specifications
- **🌐 Distributed Architecture**: Multiple instances with CouchDB active-active replication
- **⚡ High Availability**: Each instance remains fully operational during network issues
- **👥 User Management**: Complete user lifecycle management through OIDC flows
- **🎫 Session Management**: Distributed session handling across instances
- **🛡️ Security Hardened**: Rate limiting, input validation, CORS protection, and CSRF protection

## Architecture

Zombie consists of multiple instances that can be deployed across different geographic locations. Each instance:

- Maintains a local CouchDB database for users and sessions
- Can handle all OIDC authentication operations independently
- Syncs with other instances through CouchDB active-active replication
- Provides consistent authentication across all instances

### Example Deployment Scenario

- **Data Center 1**: Primary instance serving production traffic
- **Data Center 2**: Secondary instance for redundancy  
- **Home Lab**: Personal instance for local services

If the home lab loses internet connectivity, it continues to authenticate local users. When connectivity is restored, data syncs automatically through CouchDB replication.

## Quick Start

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/HodlOnToYourButts/Zombie.git
   cd Zombie
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up CouchDB and database**:
   ```bash
   # For development with local CouchDB
   ./scripts/couchdb-setup.sh

   # For container deployments, see Container Setup section below
   ```

5. **Start the server**:
   ```bash
   npm start
   ```

### Production Setup

1. **Set up production environment**:
   ```bash
   cp .env.example .env.production
   # Configure production environment variables
   ```

2. **Deploy with your preferred method**:
   ```bash
   # Example with systemd
   sudo cp zombie.service /etc/systemd/system/
   sudo systemctl enable zombie
   sudo systemctl start zombie
   ```

## Configuration

Zombie uses environment variables for configuration:

- **Database**: CouchDB connection settings
- **Security**: JWT secrets, session configuration
- **OIDC**: Client settings and endpoints
- **Network**: CORS origins, rate limiting

## Container Setup

For container-based deployments (Docker/Podman), Zombie provides separate setup containers for clean separation of concerns. Use this instead of the development setup scripts:

### 1. CouchDB Infrastructure Setup

```bash
# Run couchdb-setup container to create database and user
docker run --rm --network zombie_default \
  -e COUCHDB_URL=http://couchdb:5984 \
  -e COUCHDB_ADMIN_USER=admin \
  -e COUCHDB_ADMIN_PASSWORD=admin \
  -e COUCHDB_DATABASE=zombie \
  -e COUCHDB_USER=zombie \
  -e COUCHDB_PASSWORD=secure_password \
  curlimages/curl:latest \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/HodlOnToYourButts/Zombie/master/scripts/couchdb-setup.sh)"
```

### 2. Zombie Database Setup

```bash
# Run zombie-setup container to initialize database structure
docker run --rm --network zombie_default \
  -e COUCHDB_URL=http://couchdb:5984 \
  -e COUCHDB_DATABASE=zombie \
  -e COUCHDB_USER=zombie \
  -e COUCHDB_PASSWORD=secure_password \
  curlimages/curl:latest \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/HodlOnToYourButts/Zombie/master/scripts/zombie-setup.sh)"
```

**Setup Order:** Always run `couchdb-setup` first, then `zombie-setup`.

## OIDC Endpoints

Zombie provides standard OIDC endpoints:

- **Authorization**: `/auth`
- **Token**: `/token`
- **UserInfo**: `/userinfo`
- **JWKS**: `/.well-known/jwks.json`
- **Discovery**: `/.well-known/openid-configuration`

## Development

- **`npm start`**: Start the server
- **`npm run dev`**: Start with auto-reload
- **`npm test`**: Run test suite  
- **`npm run lint`**: Check code style
- **`npm run typecheck`**: TypeScript validation

## Security Features

- **🛡️ Rate Limiting**: Protection against brute force attacks
- **🔒 Input Validation**: Comprehensive request sanitization  
- **🌐 CORS Protection**: Restricted cross-origin requests
- **🎭 CSRF Protection**: Cross-site request forgery prevention
- **📝 Security Headers**: Helmet.js security middleware
- **🔐 Secure Sessions**: Encrypted session storage
- **🎫 JWT Security**: Signed tokens with rotation support

## Documentation

- **Environment Configuration**: See `.env.example` for all available options
- **OIDC Specification**: Follows standard OAuth2/OpenID Connect protocols

## License

AGPL-3.0 License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests for any improvements.

## Support

- **Issues**: Report bugs and feature requests on GitHub
- **Discussions**: Community support and questions
- **Documentation**: Comprehensive guides in the `/docs` directory