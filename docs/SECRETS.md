# Zombie Secrets Configuration

## Overview

Zombie production quadlets use systemd secrets to securely store sensitive environment variables. This prevents secrets from appearing in process lists or system logs.

## Setting Up Secrets

### 1. Create the secrets directory

```bash
sudo mkdir -p /etc/containers/systemd/secrets
```

### 2. Create the Zombie secrets file

Create `/etc/containers/systemd/secrets/zombieauth` with the following content:

```env
# Admin interface secrets
ADMIN_CLIENT_SECRET=your_secure_admin_client_secret
ADMIN_PASSWORD=your_secure_admin_password

# Database connection secrets (for app)
COUCHDB_PASSWORD=your_secure_zombieauth_db_password
COUCHDB_SECRET=your_secure_couchdb_secret

# Application secrets
JWT_SECRET=your_secure_jwt_secret
SESSION_SECRET=your_secure_session_secret
```

### 3. Create the CouchDB secrets file

Create `/etc/containers/systemd/secrets/couchdb` with the following content:

```env
# CouchDB admin credentials
COUCHDB_USER=your_couchdb_admin_user
COUCHDB_PASSWORD=your_couchdb_admin_password
COUCHDB_SECRET=your_secure_couchdb_secret
COUCHDB_COOKIE=your_secure_couchdb_cookie
```

### 4. Set proper permissions

```bash
sudo chmod 600 /etc/containers/systemd/secrets/zombieauth
sudo chmod 600 /etc/containers/systemd/secrets/couchdb
sudo chown root:root /etc/containers/systemd/secrets/zombieauth
sudo chown root:root /etc/containers/systemd/secrets/couchdb
```

## Secret Generation

Generate secure secrets using:

```bash
# For most secrets (32 bytes base64)
openssl rand -base64 32

# For JWT secrets (recommended 64 bytes base64)  
openssl rand -base64 64
```

## Security Notes

- Secrets are loaded as environment variables inside containers only
- Secret files should be readable only by root (600 permissions)
- Secrets are not visible in `ps` output or system logs
- Each secret should be unique and randomly generated
- Consider rotating secrets periodically

## Usage in Quadlets

The quadlets reference secret files as follows:

**Zombie services (OIDC and Admin):**
```ini
Secret=zombieauth,type=env
```

**CouchDB and cluster-status services:**
```ini
Secret=couchdb,type=env
```

This loads the entire secret file as environment variables, making all defined variables available to the container.

## Troubleshooting

### Container fails to start

1. Check secret files exist:
   - `/etc/containers/systemd/secrets/zombieauth`
   - `/etc/containers/systemd/secrets/couchdb`
2. Verify permissions: `ls -la /etc/containers/systemd/secrets/`
3. Check file format: each line should be `KEY=value` with no spaces around `=`
4. Ensure no empty lines or comments in the secret files

### Missing environment variables

1. Verify all required secrets are defined in the secret file
2. Check for typos in variable names
3. Ensure no trailing whitespace in the secret file

## Example Secret Files

### `/etc/containers/systemd/secrets/zombieauth`
```env
ADMIN_CLIENT_SECRET=Ab3dF7gH9jKl2MnP5qRs8TuV1wXyZ4cE6fGhI0jKlMnO
ADMIN_PASSWORD=MySecureAdminPassword123!
COUCHDB_PASSWORD=Zombie_DB_P@ssw0rd_2024
COUCHDB_SECRET=aB3dE6fG9hI2jK5lM8nP1qR4sT7uV0wX3yZ6aC9eF2gH
JWT_SECRET=jW7tS3cr3t_F0r_JWT_T0k3nS_Th4t_1s_V3ry_L0ng_4nd_S3cur3_123456789
SESSION_SECRET=s3ss10n_S3cr3t_F0r_C00k13_S1gn1ng_Th4t_1s_4ls0_V3ry_L0ng
```

### `/etc/containers/systemd/secrets/couchdb`
```env
COUCHDB_USER=couchdb_admin
COUCHDB_PASSWORD=CouchDB_Admin_P@ssw0rd_2024
COUCHDB_SECRET=aB3dE6fG9hI2jK5lM8nP1qR4sT7uV0wX3yZ6aC9eF2gH
COUCHDB_COOKIE=C0uchDB_Cluster_C00k13_F0r_N0d3_C0mmun1cat10n_123456789
```