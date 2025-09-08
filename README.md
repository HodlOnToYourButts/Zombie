# ZombieAuth

A lightweight, distributed OAuth2/OpenID Connect authentication server designed to survive network partitions and remain operational in isolated environments.

## Overview

ZombieAuth is a Keycloak alternative that provides OAuth2/OpenID Connect authentication services with a focus on high availability and partition tolerance. Built with CouchDB as the backend, it supports multi-instance clustering where each node can operate independently during network partitions while maintaining eventual consistency when connectivity is restored.

## Key Features

- **🔐 OAuth2 & OpenID Connect**: Full compliance with OAuth2 and OpenID Connect specifications
- **🌐 Distributed Architecture**: Multi-instance clustering with CouchDB master-master replication
- **⚡ Partition Tolerance**: Each instance remains fully operational during network isolation
- **🔧 Conflict Resolution**: Intelligent merge strategies for handling data conflicts after partition recovery
- **👥 User Management**: Complete user lifecycle management with admin interface
- **🎫 Session Management**: Distributed session handling across cluster nodes
- **🚀 Easy Deployment**: Automated development and production deployment scripts
- **🛡️ Security Hardened**: Rate limiting, input validation, CORS protection, and CSRF protection

## Architecture

ZombieAuth consists of multiple instances that can be deployed across different geographic locations. Each instance:

- Maintains a local CouchDB database for users and sessions
- Can handle all authentication operations independently
- Syncs with other instances when network connectivity allows
- Resolves conflicts intelligently when partitions are healed

### Example Deployment Scenario

- **Data Center 1**: Primary instance serving production traffic
- **Data Center 2**: Secondary instance for redundancy  
- **Home Lab**: Personal instance for local services

If the home lab loses internet connectivity, it continues to authenticate local users. When connectivity is restored, any conflicting changes are detected and resolved through the admin interface.

## Quick Start

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/HodlOnToYourButts/ZombieAuth.git
   cd ZombieAuth
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Generate development configuration**:
   ```bash
   ./scripts/create-development.sh
   ```

4. **Start the development cluster**:
   ```bash
   ./scripts/start-development.sh
   ```

5. **Access the admin interface**:
   - **Node 1**: http://localhost:3000/admin
   - **Node 2**: http://localhost:3001/admin  
   - **Node 3**: http://localhost:3002/admin
   - **Credentials**: admin / admin

### Production Setup

1. **Generate production configuration**:
   ```bash
   ./scripts/create-production.sh --instances 3 --names node1,node2,node3 --domains auth1.example.com,auth2.example.com,auth3.example.com
   ```

2. **Deploy to each server**:
   ```bash
   # On each server, copy the appropriate instance directory
   sudo cp production/node1/* /etc/containers/systemd/
   sudo systemctl daemon-reload
   sudo systemctl start couchdb.service zombieauth.service
   ```

## Deployment Scripts

### Development Scripts

- **`./scripts/create-development.sh`**: Generates development configuration
  - Creates `development/docker-compose.yml` with dynamic instance count
  - Generates `development/development.env` with secure secrets
  - Options: `--instances`, `--names`, `--base-port`, `--regenerate-secrets`

- **`./scripts/start-development.sh`**: Starts development cluster
  - Sets up CouchDB cluster with automatic node discovery
  - Creates application users and databases
  - Starts all services with proper dependencies

### Production Scripts

- **`./scripts/create-production.sh`**: Generates production systemd quadlets
  - Creates systemd container files for each instance
  - Generates secure secrets and configurations
  - Options: `--instances`, `--names`, `--domains`, `--output-dir`

## Configuration Options

### Development Configuration

The development setup automatically generates secure configurations including:

- **CouchDB credentials**: Admin and application user passwords
- **JWT secrets**: Token signing keys
- **Session secrets**: Session encryption keys  
- **Client IDs**: OAuth2 client identifiers
- **Cluster mapping**: Instance discovery and health monitoring

### Production Configuration

Production deployments include additional security features:

- **CORS origins**: Restricted to configured domains
- **Rate limiting**: Protection against brute force attacks
- **Input validation**: Comprehensive request sanitization
- **Secure defaults**: Production-hardened configurations

### Customization

Both scripts support customization:

```bash
# Development with custom configuration
./scripts/create-development.sh --instances 5 --names dc1,dc2,dc3,home,backup --base-port 4000

# Production with custom domains
./scripts/create-production.sh --domains auth.company.com,auth-eu.company.com,auth-asia.company.com
```

## Conflict Resolution

When network partitions heal, ZombieAuth detects conflicts through the admin interface:

- **User conflicts**: Users created with the same email on different instances
- **Role conflicts**: Different role assignments for the same user
- **Session conflicts**: Inconsistent session states

Resolution strategies available:
- **Merge**: Combine conflicting data intelligently
- **Choose winner**: Select one version over another
- **Manual review**: Flag for administrator decision

## Admin Interface Features

- **📊 Dashboard**: Cluster health and statistics
- **👥 User Management**: Create, edit, and manage users
- **🎫 Session Management**: View and invalidate user sessions
- **🔧 Client Management**: OAuth2 client configuration
- **⚠️ Conflict Resolution**: Handle data conflicts after partitions
- **📈 Activity Logs**: Audit trail of administrative actions

## Development

- **`npm start`**: Start single instance
- **`npm run dev`**: Start with auto-reload
- **`npm test`**: Run test suite  
- **`npm run lint`**: Check code style
- **`npm run typecheck`**: TypeScript validation

## Network Partition Testing

Test partition tolerance with the included script:

```bash
./scripts/test-network-partition.sh
```

This simulates network failures by stopping containers and demonstrates how the cluster handles partitions and recovery.

## Security Features

- **🛡️ Rate Limiting**: Protection against brute force attacks
- **🔒 Input Validation**: Comprehensive request sanitization  
- **🌐 CORS Protection**: Restricted cross-origin requests
- **🎭 CSRF Protection**: Cross-site request forgery prevention
- **📝 Security Headers**: Helmet.js security middleware
- **🔐 Secure Sessions**: Encrypted session storage
- **🎫 JWT Security**: Signed tokens with rotation support

## Documentation

- **[MULTI-INSTANCE.md](MULTI-INSTANCE.md)**: Detailed clustering and replication documentation
- **Admin Interface**: Built-in help and documentation
- **API Documentation**: Available at `/admin/api` endpoints

## License

AGPL-3.0 License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests for any improvements.

## Support

- **Issues**: Report bugs and feature requests on GitHub
- **Discussions**: Community support and questions
- **Documentation**: Comprehensive guides in the `/docs` directory