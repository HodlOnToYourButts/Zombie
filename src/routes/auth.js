const express = require('express');
const User = require('../models/User');
const Session = require('../models/Session');
const Activity = require('../models/Activity');
const Client = require('../models/Client');
const jwtManager = require('../utils/jwt');
const { getClientIp } = require('../utils/ip-helper');
const { validationRules, handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Authorization endpoint - handles OAuth2/OIDC authorization requests  
router.get('/auth', validationRules.authorize, handleValidationErrors, async (req, res) => {
  try {
    const {
      response_type,
      client_id,
      redirect_uri,
      scope = 'openid',
      state,
      nonce,
      username,
      password
    } = req.query;

    // Validate required parameters
    if (!response_type || !client_id || !redirect_uri) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters: response_type, client_id, redirect_uri'
      });
    }

    // Validate client
    const client = await Client.findByClientId(client_id);
    if (!client || !client.enabled) {
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Invalid or disabled client'
      });
    }

    // Validate redirect URI
    if (!client.isRedirectUriAllowed(redirect_uri)) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Invalid redirect_uri for this client'
      });
    }

    // Validate response type
    if (!client.isResponseTypeAllowed(response_type)) {
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: `Response type ${response_type} not allowed for this client`
      });
    }

    // Validate scopes
    const scopes = scope.split(' ').filter(s => s);
    if (!client.isScopeAllowed(scopes)) {
      return res.status(400).json({
        error: 'invalid_scope',
        error_description: 'Requested scope not allowed for this client'
      });
    }

    // Validate response_type
    if (!['code', 'token', 'id_token'].includes(response_type)) {
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: `Unsupported response_type: ${response_type}`
      });
    }

    // If no credentials provided, show login form
    if (!username || !password) {
      return res.render('oauth-login', {
        layout: false,
        client_id,
        redirect_uri,
        scope,
        state,
        nonce,
        response_type,
        authUrl: '/auth',
        error: req.query.error,
        success: req.query.success
      });
    }

    // Authenticate user
    const user = await User.findByUsername(username);
    if (!user || !user.isUsable()) {
      const errorMessage = !user ? 'Invalid credentials' :
                          !user.enabled ? 'Account disabled' :
                          'Account has sync conflicts';
      return redirectWithError(res, redirect_uri, state, 'access_denied', errorMessage);
    }

    const isValidPassword = await user.verifyPassword(password);
    if (!isValidPassword) {
      return redirectWithError(res, redirect_uri, state, 'access_denied', 'Invalid credentials');
    }

    // Update last login
    user.updateLastLogin();
    await user.save();

    // Log activity
    await Activity.logActivity('login', {
      username: user.username,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    // Handle different response types
    if (response_type === 'code') {
      // Authorization Code Flow
      const authCode = jwtManager.generateAuthorizationCode(
        user, client_id, redirect_uri, scopes, nonce
      );

      console.log('Generated authorization code:', authCode.substring(0, 20) + '...');

      // Create session
      const session = new Session({
        userId: user._id,
        clientId: client_id,
        redirectUri: redirect_uri,
        scopes: scopes,
        authorizationCode: authCode,
        nonce: nonce,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
      });
      await session.save();
      console.log('Created session:', session._id, 'with auth code for user:', user.username);

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.append('code', authCode);
      if (state) redirectUrl.searchParams.append('state', state);
      
      return res.redirect(redirectUrl.toString());
      
    } else if (response_type === 'token') {
      // Implicit Flow (Access Token)
      const accessToken = jwtManager.generateAccessToken(user, client_id, scopes);
      
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.hash = `access_token=${accessToken}&token_type=bearer&scope=${scopes.join(' ')}`;
      if (state) redirectUrl.hash += `&state=${state}`;
      
      return res.redirect(redirectUrl.toString());
      
    } else if (response_type === 'id_token') {
      // Implicit Flow (ID Token)
      if (!scopes.includes('openid')) {
        return redirectWithError(res, redirect_uri, state, 'invalid_scope', 'openid scope required for id_token response type');
      }
      
      const idToken = jwtManager.generateIdToken(user, client_id, nonce);
      
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.hash = `id_token=${idToken}&token_type=bearer`;
      if (state) redirectUrl.hash += `&state=${state}`;
      
      return res.redirect(redirectUrl.toString());
    }

  } catch (error) {
    console.error('Authorization error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

// Token endpoint - exchanges authorization code for tokens (GET handler for compatibility)
router.get('/token', validationRules.token, handleValidationErrors, async (req, res) => {
  // For GET requests, copy query parameters to body format for processing
  req.body = { ...req.query };
  return handleTokenRequest(req, res);
});

// Token endpoint - exchanges authorization code for tokens (POST handler)
router.post('/token', validationRules.token, handleValidationErrors, async (req, res) => {
  return handleTokenRequest(req, res);
});

// Shared token request handler
async function handleTokenRequest(req, res) {
  try {
    const {
      grant_type,
      code,
      redirect_uri,
      client_id,
      client_secret,
      refresh_token
    } = req.body;

    if (!grant_type) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing grant_type parameter'
      });
    }

    if (grant_type === 'authorization_code') {
      // Authorization Code Grant
      if (!code || !redirect_uri || !client_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters for authorization_code grant'
        });
      }

      // Verify authorization code
      let codePayload;
      try {
        codePayload = jwtManager.verifyToken(code, 'refresh'); // Using refresh secret for auth codes
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code'
        });
      }

      // Validate code parameters
      if (codePayload.aud !== client_id || codePayload.redirect_uri !== redirect_uri) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code validation failed'
        });
      }

      // Find and invalidate session
      console.log('Looking for session with auth code:', code.substring(0, 20) + '...');
      const session = await Session.findByAuthCode(code);
      console.log('Session found:', !!session, 'Active:', session?.active, 'Session ID:', session?._id);

      if (!session) {
        console.log('No session found for authorization code');
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code not found'
        });
      }

      if (!session.active) {
        console.log('Session found but not active');
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code already used'
        });
      }

      // Get user
      const user = await User.findById(codePayload.sub);
      if (!user || !user.isUsable()) {
        const errorDescription = !user ? 'User not found' :
                               !user.enabled ? 'User disabled' :
                               'User has sync conflicts';
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: errorDescription
        });
      }

      // Generate tokens
      const scopes = codePayload.scope ? codePayload.scope.split(' ') : ['openid'];
      const accessToken = jwtManager.generateAccessToken(user, client_id, scopes);
      const refreshToken = jwtManager.generateRefreshToken(user, client_id);
      
      let idToken = null;
      if (scopes.includes('openid')) {
        idToken = jwtManager.generateIdToken(user, client_id, codePayload.nonce);
      }

      // Update session with tokens
      session.setTokens(accessToken, refreshToken, idToken);
      session.authorizationCode = null; // Clear the used auth code
      await session.save();

      const response = {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: jwtManager.parseExpiry(jwtManager.accessTokenExpiry),
        refresh_token: refreshToken,
        scope: scopes.join(' ')
      };

      if (idToken) {
        response.id_token = idToken;
      }

      return res.json(response);
      
    } else if (grant_type === 'refresh_token') {
      // Refresh Token Grant
      if (!refresh_token || !client_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing refresh_token or client_id'
        });
      }

      // Verify refresh token
      let tokenPayload;
      try {
        tokenPayload = jwtManager.verifyToken(refresh_token, 'refresh');
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired refresh token'
        });
      }

      if (tokenPayload.aud !== client_id || tokenPayload.type !== 'refresh') {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Refresh token validation failed'
        });
      }

      // Get user
      const user = await User.findById(tokenPayload.sub);
      if (!user || !user.isUsable()) {
        const errorDescription = !user ? 'User not found' :
                               !user.enabled ? 'User disabled' :
                               'User has sync conflicts';
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: errorDescription
        });
      }

      // Generate new access token
      const scopes = ['openid']; // Default scopes for refresh
      const newAccessToken = jwtManager.generateAccessToken(user, client_id, scopes);
      
      const response = {
        access_token: newAccessToken,
        token_type: 'bearer',
        expires_in: jwtManager.parseExpiry(jwtManager.accessTokenExpiry),
        scope: scopes.join(' ')
      };

      return res.json(response);
      
    } else {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: `Unsupported grant_type: ${grant_type}`
      });
    }

  } catch (error) {
    console.error('Token error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
}

// UserInfo endpoint - returns user information for valid access token
router.get('/userinfo', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing or invalid authorization header'
      });
    }

    const accessToken = authHeader.substring(7);
    
    // Verify access token
    let tokenPayload;
    try {
      tokenPayload = jwtManager.verifyToken(accessToken, 'access');
    } catch (error) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid or expired access token'
      });
    }

    // Get user
    const user = await User.findById(tokenPayload.sub);
    if (!user || !user.isUsable()) {
      const errorDescription = !user ? 'User not found' :
                             !user.enabled ? 'User disabled' :
                             'User has sync conflicts';
      return res.status(401).json({
        error: 'invalid_token',
        error_description: errorDescription
      });
    }

    // Return user info based on scopes
    const scopes = tokenPayload.scope ? tokenPayload.scope.split(' ') : [];
    const userInfo = {
      sub: user._id
    };

    if (scopes.includes('profile')) {
      userInfo.preferred_username = user.username;
      userInfo.given_name = user.firstName;
      userInfo.family_name = user.lastName;
      userInfo.groups = user.groups;
      userInfo.roles = user.roles;
    }

    if (scopes.includes('email')) {
      userInfo.email = user.email;
      userInfo.email_verified = user.emailVerified;
    }

    return res.json(userInfo);

  } catch (error) {
    console.error('UserInfo error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

// JWKS endpoint - provides public keys for token verification
router.get('/.well-known/jwks.json', (req, res) => {
  res.json(jwtManager.getJWKS());
});

function redirectWithError(res, redirectUri, state, error, errorDescription) {
  const url = new URL(redirectUri);
  url.searchParams.append('error', error);
  url.searchParams.append('error_description', errorDescription);
  if (state) url.searchParams.append('state', state);
  
  return res.redirect(url.toString());
}

// User Registration Routes
router.get('/register', (req, res) => {
  const returnUrl = req.query.returnUrl || req.get('Referer') || '/login';
  res.render('register', {
    layout: false,
    error: req.query.error,
    success: req.query.success,
    returnUrl
  });
});

router.post('/register', validationRules.register, handleValidationErrors, async (req, res) => {
  try {
    const { username, email, password, confirmPassword, returnUrl } = req.body;
    const finalReturnUrl = returnUrl || req.get('Referer') || '/login';
    
    // Validate inputs
    if (!username || !email || !password || !confirmPassword) {
      return res.render('register', {
        layout: false,
        error: 'All fields are required',
        username,
        email,
        returnUrl: finalReturnUrl
      });
    }
    
    if (password !== confirmPassword) {
      return res.render('register', {
        layout: false,
        error: 'Passwords do not match',
        username,
        email,
        returnUrl: finalReturnUrl
      });
    }
    
    if (password.length < 6) {
      return res.render('register', {
        layout: false,
        error: 'Password must be at least 6 characters long',
        username,
        email,
        returnUrl: finalReturnUrl
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.render('register', {
        layout: false,
        error: 'Username already exists',
        username,
        email,
        returnUrl: finalReturnUrl
      });
    }
    
    const existingEmailUser = await User.findByEmail(email);
    if (existingEmailUser) {
      return res.render('register', {
        layout: false,
        error: 'Email already registered',
        username,
        email,
        returnUrl: finalReturnUrl
      });
    }
    
    // Hash the password before creating user
    const passwordHash = await User.hashPassword(password);
    
    // Create new user
    const userData = {
      username,
      email,
      passwordHash,
      enabled: true,
      roles: ['user'], // Default role
      groups: []
    };
    
    const user = new User(userData);
    await user.save();
    
    // Log registration activity
    await Activity.logActivity('user_created', {
      targetUsername: username,
      targetUserId: user._id,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      selfRegistration: true
    });
    
    // Redirect to login page with success message
    const loginUrl = new URL(finalReturnUrl, `${req.protocol}://${req.get('host')}`);
    loginUrl.searchParams.set('success', 'Account created successfully! You can now sign in.');
    res.redirect(loginUrl.toString());
    
  } catch (error) {
    console.error('Registration error:', error);
    res.render('register', {
      layout: false,
      error: 'Registration failed. Please try again.',
      username: req.body.username,
      email: req.body.email,
      returnUrl: finalReturnUrl
    });
  }
});

// General login route 
router.get('/login', (req, res) => {
  res.render('login', { layout: false });
});

// OIDC logout endpoint
router.get('/logout', (req, res) => {
  const post_logout_redirect_uri = req.query.post_logout_redirect_uri;
  
  // Destroy session
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    
    // Redirect to post_logout_redirect_uri if provided, otherwise to root
    const redirectUrl = post_logout_redirect_uri || '/';
    res.redirect(redirectUrl);
  });
});

module.exports = router;