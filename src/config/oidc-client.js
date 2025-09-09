const crypto = require('crypto');

// Dynamic OIDC Client configuration based on current request
function getAdminClientConfig(req) {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const instanceId = process.env.INSTANCE_ID || 'default';
  
  const clientId = process.env.DEFAULT_CLIENT_ID;
  console.log(`DEBUG: OIDC getAdminClientConfig using client_id: ${clientId}`);
  
  return {
    client_id: clientId,
    client_secret: process.env.ADMIN_CLIENT_SECRET || 'zombieauth-admin-secret-change-in-production',
    redirect_uri: `${protocol}://${host}/callback`,
    post_logout_redirect_uri: `${protocol}://${host}/login`,
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    scope: 'openid profile email',
    token_endpoint_auth_method: 'client_secret_basic'
  };
}

// Static OIDC Client configuration for database initialization
const clientIdForConfig = process.env.DEFAULT_CLIENT_ID;
console.log(`DEBUG: ADMIN_CLIENT_CONFIG using client_id: ${clientIdForConfig}`);

const ADMIN_CLIENT_CONFIG = {
  client_id: clientIdForConfig,
  client_secret: process.env.ADMIN_CLIENT_SECRET || 'zombieauth-admin-secret-change-in-production',
  redirect_uri: process.env.ADMIN_REDIRECT_URI || 'http://localhost:4000/callback',
  post_logout_redirect_uri: process.env.ADMIN_LOGOUT_REDIRECT_URI || 'http://localhost:4000/login',
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  scope: 'openid profile email',
  token_endpoint_auth_method: 'client_secret_basic'
};

// OIDC endpoints
const getOidcEndpoints = (baseUrl = process.env.ISSUER || 'http://localhost:3000') => {
  // For internal container communication, use OIDC_INTERNAL_BASE_URL if available
  // For external URLs (like authorization_endpoint), use the configured ISSUER
  const internalBaseUrl = process.env.OIDC_INTERNAL_BASE_URL || 'http://localhost:3000';
  
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/auth`,
    token_endpoint: `${internalBaseUrl}/token`,
    userinfo_endpoint: `${internalBaseUrl}/userinfo`,
    jwks_uri: `${internalBaseUrl}/.well-known/jwks.json`,
    end_session_endpoint: `${baseUrl}/logout`
  };
};

module.exports = {
  ADMIN_CLIENT_CONFIG,
  getAdminClientConfig,
  getOidcEndpoints
};