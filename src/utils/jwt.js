const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTManager {
  constructor() {
    this.secret = process.env.JWT_SECRET || 'your-secret-key-here';
    this.issuer = process.env.ISSUER || 'http://localhost:3000';
    this.accessTokenExpiry = process.env.JWT_EXPIRES_IN || '1h';
    this.refreshTokenExpiry = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    
    // Generate RSA key pair for signing (in production, this should be persistent)
    this.keyPair = this.generateKeyPair();
  }

  generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
  }

  generateAccessToken(user, clientId, scopes = ['openid']) {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      iss: this.issuer,
      sub: user._id,
      aud: clientId,
      exp: now + this.parseExpiry(this.accessTokenExpiry),
      iat: now,
      auth_time: now,
      scope: scopes.join(' '),
      
      // Standard OIDC claims
      email: user.email,
      email_verified: user.emailVerified,
      preferred_username: user.username,
      given_name: user.firstName,
      family_name: user.lastName,
      groups: user.groups,
      roles: user.roles
    };

    return jwt.sign(payload, this.keyPair.privateKey, {
      algorithm: 'RS256',
      keyid: 'default'
    });
  }

  generateIdToken(user, clientId, nonce = null) {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      iss: this.issuer,
      sub: user._id,
      aud: clientId,
      exp: now + this.parseExpiry(this.accessTokenExpiry),
      iat: now,
      auth_time: now,
      
      // OIDC standard claims
      email: user.email,
      email_verified: user.emailVerified,
      preferred_username: user.username,
      given_name: user.firstName,
      family_name: user.lastName,
      groups: user.groups,
      roles: user.roles
    };

    if (nonce) {
      payload.nonce = nonce;
    }

    return jwt.sign(payload, this.keyPair.privateKey, {
      algorithm: 'RS256',
      keyid: 'default'
    });
  }

  generateRefreshToken(user, clientId) {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      iss: this.issuer,
      sub: user._id,
      aud: clientId,
      exp: now + this.parseExpiry(this.refreshTokenExpiry),
      iat: now,
      type: 'refresh'
    };

    return jwt.sign(payload, this.secret, { algorithm: 'HS256' });
  }

  generateAuthorizationCode(user, clientId, redirectUri, scopes, nonce = null) {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      iss: this.issuer,
      sub: user._id,
      aud: clientId,
      exp: now + 600, // 10 minutes
      iat: now,
      type: 'auth_code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      nonce
    };

    return jwt.sign(payload, this.secret, { algorithm: 'HS256' });
  }

  verifyToken(token, type = 'access') {
    try {
      if (type === 'access') {
        return jwt.verify(token, this.keyPair.publicKey, { 
          algorithm: 'RS256',
          issuer: this.issuer 
        });
      } else {
        return jwt.verify(token, this.secret, { 
          algorithm: 'HS256',
          issuer: this.issuer 
        });
      }
    } catch (error) {
      throw new Error(`Invalid ${type} token: ${error.message}`);
    }
  }

  getPublicKey() {
    return this.keyPair.publicKey;
  }

  getJWKS() {
    // Convert PEM to JWK format
    const key = crypto.createPublicKey(this.keyPair.publicKey);
    const jwk = key.export({ format: 'jwk' });
    
    return {
      keys: [{
        ...jwk,
        kid: 'default',
        use: 'sig',
        alg: 'RS256'
      }]
    };
  }

  parseExpiry(expiry) {
    if (typeof expiry === 'number') return expiry;
    
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // default 1 hour
    
    const [, value, unit] = match;
    const multipliers = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400
    };
    
    return parseInt(value) * multipliers[unit];
  }
}

module.exports = new JWTManager();