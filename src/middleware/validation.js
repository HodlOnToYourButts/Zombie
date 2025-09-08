const { body, param, query, validationResult } = require('express-validator');

// Common validation rules
const commonRules = {
  username: body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username must be 3-50 characters and contain only letters, numbers, dots, hyphens, and underscores'),
  
  email: body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage('Must be a valid email address'),
  
  password: body('password')
    .isLength({ min: 8, max: 128 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be at least 8 characters with lowercase, uppercase, and number'),
  
  clientId: body('clientId')
    .trim()
    .matches(/^client_[a-f0-9]{32}$/)
    .withMessage('Client ID must be in format: client_[32 hex characters]'),
  
  redirectUri: body('redirectUris.*')
    .isURL({ protocols: ['http', 'https'], require_tld: false })
    .isLength({ max: 255 })
    .withMessage('Redirect URI must be a valid URL'),
  
  scope: query('scope')
    .optional()
    .matches(/^[a-zA-Z0-9\s]+$/)
    .withMessage('Scope must contain only letters, numbers, and spaces'),
  
  state: query('state')
    .optional()
    .isLength({ max: 255 })
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('State parameter contains invalid characters'),
};

// Validation rule sets for different endpoints
const validationRules = {
  // Authentication endpoints
  login: [
    commonRules.username.withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  
  register: [
    commonRules.username,
    commonRules.email,
    commonRules.password,
    body('confirmPassword')
      .custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Passwords do not match');
        }
        return true;
      })
  ],
  
  // OAuth2 endpoints
  authorize: [
    query('client_id')
      .matches(/^client_[a-f0-9]{32}$/)
      .withMessage('Invalid client_id format'),
    query('redirect_uri')
      .isURL({ protocols: ['http', 'https'], require_tld: false })
      .withMessage('Invalid redirect_uri'),
    query('response_type')
      .isIn(['code', 'token', 'id_token'])
      .withMessage('Invalid response_type'),
    commonRules.scope,
    commonRules.state
  ],
  
  token: [
    body('grant_type')
      .isIn(['authorization_code', 'client_credentials', 'refresh_token'])
      .withMessage('Invalid grant_type'),
    body('client_id')
      .matches(/^client_[a-f0-9]{32}$/)
      .withMessage('Invalid client_id format'),
    body('client_secret')
      .optional()
      .isLength({ min: 32, max: 128 })
      .withMessage('Invalid client_secret'),
    body('code')
      .optional()
      .isLength({ min: 16, max: 1024 })
      .matches(/^[A-Za-z0-9\.\-_]+$/)
      .withMessage('Invalid authorization code format'),
    body('redirect_uri')
      .optional()
      .isURL({ protocols: ['http', 'https'], require_tld: false })
      .withMessage('Invalid redirect_uri')
  ],
  
  // Admin endpoints
  createClient: [
    body('name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .matches(/^[a-zA-Z0-9\s._-]+$/)
      .withMessage('Client name must be 1-100 characters, letters, numbers, spaces, dots, hyphens, underscores'),
    body('redirectUris')
      .isArray({ min: 1 })
      .withMessage('At least one redirect URI is required'),
    commonRules.redirectUri,
    body('allowedScopes')
      .optional()
      .isArray()
      .withMessage('Allowed scopes must be an array')
  ],
  
  updateClient: [
    param('clientId')
      .matches(/^client_[a-f0-9]{32}$/)
      .withMessage('Invalid client ID format'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .matches(/^[a-zA-Z0-9\s._-]+$/)
      .withMessage('Client name must be 1-100 characters'),
    body('redirectUris')
      .optional()
      .isArray({ min: 1 })
      .withMessage('Redirect URIs must be a non-empty array'),
    body('redirectUris.*')
      .optional()
      .isURL({ protocols: ['http', 'https'], require_tld: false })
      .withMessage('Invalid redirect URI')
  ],
  
  // User management
  updateUser: [
    param('userId')
      .isAlphanumeric()
      .isLength({ min: 1, max: 50 })
      .withMessage('Invalid user ID'),
    body('email')
      .optional()
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Invalid email address'),
    body('roles')
      .optional()
      .isArray()
      .withMessage('Roles must be an array'),
    body('roles.*')
      .optional()
      .isIn(['admin', 'user'])
      .withMessage('Invalid role')
  ],
  
  // Session management
  deleteSession: [
    param('sessionId')
      .isAlphanumeric()
      .isLength({ min: 16, max: 128 })
      .withMessage('Invalid session ID')
  ]
};

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));
    
    // Log validation failures for security monitoring
    console.warn('Validation failed:', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      errors: errorMessages
    });
    
    return res.status(400).json({
      error: 'Invalid input',
      details: errorMessages
    });
  }
  next();
};

// Sanitization middleware for common XSS prevention
const sanitizeInput = (req, res, next) => {
  // Remove null bytes and control characters
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[\x00-\x1F\x7F]/g, '');
  };
  
  // Recursively sanitize object properties
  const sanitizeObject = (obj) => {
    if (obj === null || typeof obj !== 'object') {
      return sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  };
  
  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  next();
};

module.exports = {
  validationRules,
  handleValidationErrors,
  sanitizeInput,
  commonRules
};