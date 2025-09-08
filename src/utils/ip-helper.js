/**
 * Get the real client IP address, accounting for proxy headers
 * @param {object} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  // Check various headers that proxies/load balancers might set
  const forwarded = req.headers['x-forwarded-for'];
  
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs, the first one is the original client
    const ips = forwarded.split(',').map(ip => ip.trim());
    const clientIp = ips[0];
    
    // Filter out private/local IPs to get the real external IP
    if (isPublicIP(clientIp)) {
      return clientIp;
    }
    
    // If first IP is private, try to find a public IP in the chain
    for (const ip of ips) {
      if (isPublicIP(ip)) {
        return ip;
      }
    }
    
    // If no public IP found, return the first IP anyway
    return clientIp;
  }
  
  // Try other proxy headers
  const realIp = req.headers['x-real-ip'] || 
                 req.headers['x-client-ip'] ||
                 req.headers['cf-connecting-ip']; // Cloudflare
                 
  if (realIp && isPublicIP(realIp)) {
    return realIp;
  }
  
  // Fall back to Express's req.ip (which respects trust proxy setting)
  if (req.ip && isPublicIP(req.ip)) {
    return req.ip;
  }
  
  // Last resort - use connection remote address
  const connectionIp = req.connection?.remoteAddress || req.socket?.remoteAddress;
  if (connectionIp && isPublicIP(connectionIp)) {
    return connectionIp;
  }
  
  // If we still don't have a public IP, return whatever we have
  return req.ip || connectionIp || 'unknown';
}

/**
 * Check if an IP address is public (not private/local/loopback)
 * @param {string} ip - IP address to check
 * @returns {boolean} True if IP is public
 */
function isPublicIP(ip) {
  if (!ip || ip === 'unknown') return false;
  
  // Remove IPv6 wrapper if present
  const cleanIp = ip.replace(/^::ffff:/, '');
  
  // Check for IPv4 private ranges
  if (/^10\./.test(cleanIp)) return false;                    // 10.0.0.0/8
  if (/^192\.168\./.test(cleanIp)) return false;              // 192.168.0.0/16
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(cleanIp)) return false; // 172.16.0.0/12
  
  // Check for loopback and local addresses
  if (/^127\./.test(cleanIp)) return false;                   // 127.0.0.0/8
  if (/^169\.254\./.test(cleanIp)) return false;              // 169.254.0.0/16 (link-local)
  if (cleanIp === '::1' || cleanIp === 'localhost') return false;
  
  // Check for IPv6 local addresses
  if (/^fe80::/i.test(cleanIp)) return false;                 // Link-local
  if (/^fc00::/i.test(cleanIp) || /^fd00::/i.test(cleanIp)) return false; // Unique local
  
  return true;
}

module.exports = {
  getClientIp,
  isPublicIP
};