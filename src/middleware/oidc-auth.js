// Node.js 18+ has built-in fetch
const { URLSearchParams } = require('url');
const { ADMIN_CLIENT_CONFIG, getAdminClientConfig, getOidcEndpoints } = require('../config/oidc-client');
const jwtManager = require('../utils/jwt');
const User = require('../models/User');

class OIDCAuthMiddleware {
  constructor() {
    this.endpoints = getOidcEndpoints();
  }

  // Generate authorization URL for OIDC login
  generateAuthUrl(req, state, nonce) {
    const clientConfig = getAdminClientConfig(req);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientConfig.client_id,
      redirect_uri: clientConfig.redirect_uri,
      scope: clientConfig.scope,
      state: state,
      nonce: nonce
    });

    return `${this.endpoints.authorization_endpoint}?${params.toString()}`;
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(req, code, state) {
    try {
      const clientConfig = getAdminClientConfig(req);
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: clientConfig.redirect_uri,
        client_id: clientConfig.client_id,
        client_secret: clientConfig.client_secret
      });

      const response = await fetch(this.endpoints.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Token exchange error:', error);
      throw error;
    }
  }

  // Get user info from access token
  async getUserInfo(accessToken) {
    try {
      const response = await fetch(this.endpoints.userinfo_endpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`UserInfo request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('UserInfo error:', error);
      throw error;
    }
  }

  // Verify ID token using OIDC server's public keys
  async verifyIdToken(idToken) {
    try {
      const jwt = require('jsonwebtoken');
      
      // Fetch JWKS from OIDC server
      const jwksResponse = await fetch(this.endpoints.jwks_uri);
      if (!jwksResponse.ok) {
        throw new Error(`Failed to fetch JWKS: ${jwksResponse.statusText}`);
      }
      
      const jwks = await jwksResponse.json();
      if (!jwks.keys || jwks.keys.length === 0) {
        throw new Error('No keys found in JWKS');
      }
      
      // Use the first key (assuming single key for now)
      const publicKey = jwks.keys[0];
      if (publicKey.kty !== 'RSA') {
        throw new Error('Only RSA keys are supported');
      }
      
      // Convert JWK to PEM format
      const rsaKey = this.jwkToPem(publicKey);
      
      // Verify token using OIDC server's public key
      return jwt.verify(idToken, rsaKey, {
        algorithms: ['RS256'],
        issuer: this.endpoints.issuer
      });
    } catch (error) {
      console.error('ID token verification error:', error);
      throw error;
    }
  }

  // Convert JWK RSA key to PEM format using built-in crypto
  jwkToPem(jwk) {
    const crypto = require('crypto');
    
    // Convert base64url to base64
    const n = jwk.n.replace(/-/g, '+').replace(/_/g, '/');
    const e = jwk.e.replace(/-/g, '+').replace(/_/g, '/');
    
    // Create public key object
    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: n,
        e: e
      },
      format: 'jwk'
    });
    
    return keyObject.export({
      type: 'spki',
      format: 'pem'
    });
  }

  // Middleware to require OIDC authentication
  requireOidcAuth(requiredRole = null) {
    return async (req, res, next) => {
      console.log('requireOidcAuth check - session.oidc_user exists:', !!req.session.oidc_user);
      // Check if user is already authenticated
      if (req.session.oidc_user) {
        try {
          // Verify the stored ID token is still valid
          const claims = await this.verifyIdToken(req.session.oidc_user.id_token);
          
          // Check if token is expired
          if (claims.exp < Math.floor(Date.now() / 1000)) {
            // Token expired, clear session
            delete req.session.oidc_user;
            return this.redirectToLogin(req, res);
          }

          // Check role if required
          if (requiredRole && (!claims.roles || !claims.roles.includes(requiredRole))) {
            return res.status(403).render('error', {
              title: 'Access Denied',
              message: `Access denied. ${requiredRole} role required.`,
              layout: false
            });
          }

          // Set user info for the request
          req.oidc_user = {
            sub: claims.sub,
            username: claims.preferred_username,
            email: claims.email,
            roles: claims.roles || [],
            groups: claims.groups || []
          };

          return next();
        } catch (error) {
          console.error('Token validation error:', error);
          delete req.session.oidc_user;
          return this.redirectToLogin(req, res);
        }
      }

      // User not authenticated, redirect to login
      return this.redirectToLogin(req, res);
    };
  }

  // Redirect to OIDC login
  redirectToLogin(req, res) {
    // Handle AJAX requests differently - return JSON instead of redirect
    if (req.xhr || req.headers['content-type'] === 'application/json' || req.path.startsWith('/admin/api/')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please refresh the page to re-authenticate',
        redirect_to: '/admin'
      });
    }

    const state = this.generateSecureRandom();
    const nonce = this.generateSecureRandom();
    
    // Store state and nonce in session for validation
    req.session.oidc_state = state;
    req.session.oidc_nonce = nonce;
    
    // For API requests, don't set the API endpoint as return URL - use admin dashboard instead
    if (!req.session.oidc_return_to) {
      req.session.oidc_return_to = req.path.startsWith('/admin/api/') ? '/admin' : req.originalUrl;
    }

    const authUrl = this.generateAuthUrl(req, state, nonce);
    res.redirect(authUrl);
  }

  // Handle OIDC callback
  async handleCallback(req, res) {
    try {
      console.log('OIDC callback received:', req.query);
      const { code, state, error, error_description } = req.query;

      // Check for OAuth error
      if (error) {
        return res.render('error', {
          title: 'Authentication Error',
          message: error_description || error,
          layout: false
        });
      }

      // Validate state parameter
      if (!state || state !== req.session.oidc_state) {
        return res.render('error', {
          title: 'Authentication Error',
          message: 'Invalid state parameter',
          layout: false
        });
      }

      if (!code) {
        return res.render('error', {
          title: 'Authentication Error',
          message: 'No authorization code received',
          layout: false
        });
      }

      // Exchange code for tokens
      console.log('Exchanging code for tokens...');
      const tokens = await this.exchangeCodeForTokens(req, code, state);
      console.log('Token exchange successful:', !!tokens.access_token);
      console.log('Tokens received:', { 
        has_access_token: !!tokens.access_token,
        has_id_token: !!tokens.id_token,
        has_refresh_token: !!tokens.refresh_token,
        id_token_type: typeof tokens.id_token
      });
      
      // Verify ID token
      const claims = await this.verifyIdToken(tokens.id_token);
      
      // Validate nonce
      if (claims.nonce !== req.session.oidc_nonce) {
        return res.render('error', {
          title: 'Authentication Error',
          message: 'Invalid nonce parameter',
          layout: false
        });
      }

      // Store user info in session
      req.session.oidc_user = {
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        claims: claims
      };

      // Create session mapping for logout functionality
      const User = require('../models/User');
      const sessionManager = require('../utils/session-manager');
      const adminUser = await User.findByUsername(claims.preferred_username);
      if (adminUser) {
        sessionManager.registerUserSession(adminUser._id, req.sessionID);
      }

      // Clean up temporary session data
      delete req.session.oidc_state;
      delete req.session.oidc_nonce;

      // Redirect to originally requested URL or admin dashboard
      const returnTo = req.session.oidc_return_to || '/admin';
      delete req.session.oidc_return_to;
      
      console.log('OIDC callback successful, saving session and redirecting to:', returnTo);
      
      // Ensure session is saved before redirecting
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.render('error', {
            title: 'Authentication Error',
            message: 'Failed to save session',
            layout: false
          });
        }
        res.redirect(returnTo);
      });
      
    } catch (error) {
      console.error('OIDC callback error:', error);
      res.render('error', {
        title: 'Authentication Error',
        message: 'Authentication failed: ' + error.message,
        layout: false
      });
    }
  }

  // Handle logout
  async handleLogout(req, res) {
    // Clean up session mapping and invalidate OIDC sessions
    if (req.session.oidc_user?.claims?.preferred_username) {
      try {
        const User = require('../models/User');
        const Session = require('../models/Session');
        const sessionManager = require('../utils/session-manager');
        
        const user = await User.findByUsername(req.session.oidc_user.claims.preferred_username);
        if (user) {
          // Remove from session mapping
          sessionManager.removeUserSession(user._id);
          
          // Invalidate all active OIDC sessions for this user
          const userSessions = await Session.findByUserId(user._id);
          for (const session of userSessions) {
            if (session.active && !session.isExpired()) {
              await session.invalidate();
              console.log(`Invalidated session ${session._id} for user ${user.username}`);
            }
          }
        }
      } catch (err) {
        console.error('Error cleaning up sessions during logout:', err);
      }
    }
    
    // Clear session
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      
      // Redirect to auth page for new login
      res.redirect('/auth');
    });
  }

  // Generate secure random string
  generateSecureRandom() {
    return require('crypto').randomBytes(32).toString('hex');
  }
}

module.exports = new OIDCAuthMiddleware();