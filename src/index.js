require('dotenv').config();

// CRITICAL: Validate security configuration before starting
const { validateSecurityConfiguration } = require('./config/security-validation');
validateSecurityConfiguration();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const methodOverride = require('method-override');
const { engine } = require('express-handlebars');
const path = require('path');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { sanitizeInput } = require('./middleware/validation');

const database = require('./database');
const authRoutes = require('./routes/auth');
const sessionManager = require('./utils/session-manager');
const SyncMonitor = require('./services/sync-monitor');

const app = express();
const PORT = 8080;

// Track server startup time for uptime calculation
const SERVER_START_TIME = Date.now();

// Helper function to format uptime in human readable format
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// Trust proxy headers to get real client IP in containerized environments
// Be specific about proxy trust to avoid rate limiter warnings
if (process.env.DEVELOPMENT_MODE !== 'true') {
  // Trust proxies from private IP ranges (containers, load balancers)
  app.set('trust proxy', ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
} else {
  app.set('trust proxy', ['127.0.0.1', '::1']); // Trust localhost only in development
}

// View engine setup
app.engine('html', engine({ 
  extname: '.html',
  defaultLayout: 'layout',
  layoutsDir: path.join(__dirname, 'views'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    formatDate: (date) => {
      return new Date(date).toLocaleString();
    },
    join: (array, separator) => {
      return Array.isArray(array) ? array.join(separator || ', ') : '';
    },
    encodeURIComponent: (str) => {
      return encodeURIComponent(str || '');
    },
    eq: (a, b) => {
      return a === b;
    }
  }
}));
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

// Middleware - minimal security headers for OIDC endpoints
app.use(helmet({
  contentSecurityPolicy: false, // Not needed for API endpoints
  crossOriginEmbedderPolicy: false
}));

// Rate limiting configuration - balanced for usability and security
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Allow 50 auth attempts per 15 minutes (much more reasonable for normal usage)
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes  
  max: 1000, // Allow 1000 requests per 15 minutes for general endpoints (very generous)
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 20, // Allow 20 requests per 15 minutes without delay (much more reasonable)
  delayMs: 250, // Add 250ms delay per request after delayAfter (reduced delay)
  maxDelayMs: 5000, // Maximum delay of 5 seconds (much more reasonable)
});

// CORS configuration - restrict origins in production
const corsOptions = {
  origin: process.env.DEVELOPMENT_MODE !== 'true' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || false
    : true, // Allow all origins in development
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizeInput); // Sanitize all inputs
app.use(methodOverride(function (req, res) {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    // Look in urlencoded POST bodies and delete it
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration - minimal for OIDC
const sessionStore = new session.MemoryStore();
sessionManager.setSessionStore(sessionStore);

app.use(session({
  name: `zombie-oidc-session-${process.env.INSTANCE_ID || 'default'}`,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.DEVELOPMENT_MODE !== 'true',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Basic info endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Still authenticating when everything else is dead.',
    status: 'running',
    oauth2: {
      authorization_endpoint: `${req.protocol}://${req.get('host')}/auth`,
      token_endpoint: `${req.protocol}://${req.get('host')}/token`,
      userinfo_endpoint: `${req.protocol}://${req.get('host')}/userinfo`,
      discovery: `${req.protocol}://${req.get('host')}/.well-known/openid_configuration`
    }
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbStatus = await database.testConnection();
  const uptimeMs = Date.now() - SERVER_START_TIME;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  
  res.json({ 
    status: dbStatus.connected ? 'ok' : 'degraded', 
    service: 'Zombie OIDC',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: {
      ms: uptimeMs,
      seconds: uptimeSeconds,
      human: formatUptime(uptimeSeconds)
    },
    database: dbStatus
  });
});

// OAuth2/OpenID Connect discovery endpoint
app.get('/.well-known/openid_configuration', (req, res) => {
  const issuer = process.env.ISSUER || `http://localhost:${PORT}`;
  
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code', 'token', 'id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email']
  });
});

// Apply rate limiting only in production
if (process.env.DEVELOPMENT_MODE !== 'true') {
  app.use('/login', authLimiter, speedLimiter);
  app.use('/register', authLimiter, speedLimiter);
  app.use('/oauth', authLimiter, speedLimiter);
  app.use('/token', authLimiter);
  app.use('/authorize', authLimiter);
  app.use('/auth', authLimiter, speedLimiter);
  app.use('/', generalLimiter);
  console.log('🔒 Rate limiting enabled for production');
} else {
  console.log('⚠️  Rate limiting disabled for development');
}

// Auth routes (OIDC endpoints only)
app.use('/', authRoutes);

// Initialize database and start server
async function startOIDCServer() {
  try {
    console.log('Initializing database connection...');
    await database.initialize();

    // Initialize database structure (design documents, indexes, etc.)
    console.log('Setting up database structure...');
    await database.initializeDatabaseStructure();

    // Initialize and start sync monitor
    console.log('Starting sync monitor...');
    const syncMonitor = new SyncMonitor();
    await syncMonitor.initialize();
    syncMonitor.startMonitoring(30000); // Check every 30 seconds
    
    app.listen(PORT, () => {
      console.log(`Zombie OIDC server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`OpenID Config: http://localhost:${PORT}/.well-known/openid_configuration`);
    });
  } catch (error) {
    console.error('Failed to start OIDC server:', error.message);
    process.exit(1);
  }
}

startOIDCServer();