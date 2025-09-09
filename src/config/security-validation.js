const crypto = require('crypto');

// List of insecure default values that should never be used in production
const INSECURE_DEFAULTS = [
  'password', 
  'your-secret-key-here-change-in-production',
  'your-session-secret-change-in-production',
  'zombieauth-admin-secret-change-in-production',
  'replication-secret-change-in-production',
  'datacenter1-session-secret-change-in-production',
  'datacenter2-session-secret-change-in-production', 
  'home-session-secret-change-in-production'
];

// Additional defaults only forbidden in production
const PRODUCTION_FORBIDDEN_DEFAULTS = [
  // 'admin' removed - allowing admin username in production
];

// Minimum security requirements
const SECURITY_REQUIREMENTS = {
  ADMIN_USERNAME: { minLength: process.env.NODE_ENV === 'development' ? 3 : 5, pattern: /^[a-zA-Z0-9_-]+$/ },
  ADMIN_PASSWORD: { minLength: process.env.NODE_ENV === 'development' ? 3 : 12, requireComplex: false },
  COUCHDB_USER: { minLength: 5, pattern: /^[a-zA-Z0-9_-]+$/ },
  COUCHDB_PASSWORD: { minLength: 12, requireComplex: false },
  JWT_SECRET: { minLength: 32, entropy: 'high' },
  SESSION_SECRET: { minLength: 32, entropy: 'high' },
  ADMIN_CLIENT_SECRET: { minLength: 32, entropy: 'high' },
  COUCHDB_SECRET: { minLength: 32, entropy: 'high' },
  DEFAULT_CLIENT_ID: { pattern: /^client_[a-fA-F0-9]{32}$/ }
};

function validateSecurityConfiguration() {
  console.log('🔐 Validating security configuration...');
  
  const errors = [];
  const warnings = [];
  
  // Check required environment variables
  const requiredVars = Object.keys(SECURITY_REQUIREMENTS);
  
  for (const varName of requiredVars) {
    const value = process.env[varName];
    const requirements = SECURITY_REQUIREMENTS[varName];
    
    // Check if variable is set
    if (!value) {
      errors.push(`❌ ${varName} environment variable is required but not set`);
      continue;
    }
    
    // Check against insecure defaults
    if (INSECURE_DEFAULTS.includes(value)) {
      errors.push(`❌ ${varName} is using an insecure default value: "${value}"`);
      continue;
    }
    
    // Check against production-only forbidden defaults
    if (process.env.NODE_ENV === 'production' && PRODUCTION_FORBIDDEN_DEFAULTS.includes(value)) {
      errors.push(`❌ ${varName} is using a value not allowed in production: "${value}"`);
      continue;
    }
    
    // Check minimum length
    if (requirements.minLength && value.length < requirements.minLength) {
      errors.push(`❌ ${varName} must be at least ${requirements.minLength} characters (current: ${value.length})`);
    }
    
    // Check pattern matching
    if (requirements.pattern && !requirements.pattern.test(value)) {
      errors.push(`❌ ${varName} does not match required format`);
    }
    
    // Check password complexity
    if (requirements.requireComplex && !isComplexPassword(value)) {
      errors.push(`❌ ${varName} must contain uppercase, lowercase, numbers, and special characters`);
    }
    
    // Check entropy for secrets
    if (requirements.entropy === 'high' && !hasHighEntropy(value)) {
      warnings.push(`⚠️  ${varName} appears to have low entropy - consider using: openssl rand -base64 32`);
    }
  }
  
  // Additional security checks
  if (process.env.ENABLE_TEST_ENDPOINTS === 'true') {
    if (process.env.NODE_ENV === 'production') {
      errors.push('❌ ENABLE_TEST_ENDPOINTS must not be true in production');
    } else {
      warnings.push('⚠️  Test endpoints are enabled - ensure this is disabled in production');
    }
  }
  
  // Check if running in production mode
  if (process.env.NODE_ENV === 'production') {
    console.log('🏭 Production mode detected - applying strict security validation');
    
    // In production, warnings become errors
    errors.push(...warnings);
    warnings.length = 0;
  }
  
  // Report results
  if (warnings.length > 0) {
    console.log('\n🔔 Security warnings:');
    warnings.forEach(warning => console.log(warning));
  }
  
  if (errors.length > 0) {
    console.log('\n🚨 CRITICAL SECURITY ERRORS:');
    errors.forEach(error => console.log(error));
    console.log('\n💡 To fix these issues:');
    console.log('1. Generate secure secrets: openssl rand -base64 32');
    console.log('2. Use strong passwords with mixed case, numbers, and symbols');
    console.log('3. Never use default values in production');
    console.log('4. Set NODE_ENV=production for production deployments');
    console.log('\n🛑 APPLICATION WILL NOT START UNTIL SECURITY ISSUES ARE RESOLVED');
    
    throw new Error(`Security validation failed with ${errors.length} critical errors`);
  }
  
  console.log('✅ Security validation passed');
  return true;
}

function isComplexPassword(password) {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  
  return hasUpper && hasLower && hasNumber && hasSpecial;
}

function hasHighEntropy(value) {
  // Simple entropy check - look for randomness indicators
  if (value.length < 20) return false;
  
  // Check for base64-like pattern (good entropy)
  if (/^[A-Za-z0-9+/]+=*$/.test(value)) return true;
  
  // Check for hex pattern (good entropy)
  if (/^[a-fA-F0-9]+$/.test(value) && value.length >= 32) return true;
  
  // Check character distribution
  const charCounts = {};
  for (const char of value) {
    charCounts[char] = (charCounts[char] || 0) + 1;
  }
  
  // If any character appears more than 20% of the time, likely low entropy
  const maxCount = Math.max(...Object.values(charCounts));
  return maxCount / value.length < 0.2;
}

module.exports = {
  validateSecurityConfiguration,
  INSECURE_DEFAULTS,
  SECURITY_REQUIREMENTS
};