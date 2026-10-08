/**
 * auth.js — lightweight JWT middleware for DocAI wizard.
 * 
 * Checks Authorization: Bearer <token> header.
 * For admin i18n endpoints, uses JWT_SECRET from .env.
 * Falls back gracefully if no token provided (for public endpoints).
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'retailcliq_erp_secret_key_2024';

/**
 * Middleware that validates JWT and attaches req.user.
 * Returns 401 if token is missing or invalid.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Authentication required', hint: 'Pass Authorization: Bearer <JWT>' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // Allow admin bypass with INTERNAL_API_KEY for service-to-service calls
    const apiKey = req.headers['x-api-key'] || req.headers['x-internal-key'];
    if (apiKey && apiKey === process.env.INTERNAL_API_KEY) {
      req.user = { role: 'admin', internal: true };
      return next();
    }
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware that validates JWT if present, but allows unauthenticated access.
 * Attaches req.user if token is valid, otherwise req.user = null.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { req.user = null; }
  } else { req.user = null; }
  next();
}

/**
 * Generate a JWT for a client (used by tenant login endpoint).
 */
function signToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '24h' });
}

module.exports = { authenticateToken, optionalAuth, signToken };
