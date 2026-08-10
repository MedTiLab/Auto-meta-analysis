import jwt from 'jsonwebtoken';
import { userDb } from '../database/db.js';

// Get JWT secret from environment or use default only for local development.
const DEFAULT_JWT_SECRET = 'claude-ui-dev-secret-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

const isUsingDefaultJwtSecret = () => JWT_SECRET === DEFAULT_JWT_SECRET;

const getLocalUser = () => {
  const existingUser = userDb.getFirstUser();
  if (existingUser) {
    return existingUser;
  }

  // A real password is intentionally not created in account-free local mode.
  return userDb.createUser('local', 'account-disabled');
};

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// Account-free local middleware. A valid legacy token is still understood so
// existing installations and exported data keep their original ownership.
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    let user = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        user = userDb.getUserById(decoded.userId);
      } catch {
        // Invalid legacy credentials fall through to the local workspace owner.
      }
    }

    user ||= getLocalUser();
    if (!user) {
      return res.status(500).json({ error: 'Local workspace identity is unavailable' });
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error('Local workspace middleware error:', error);
    return res.status(500).json({ error: 'Local workspace identity is unavailable' });
  }
};

// Generate JWT token (never expires)
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username 
    },
    JWT_SECRET
    // No expiration - token lasts forever
  );
};

// WebSocket authentication function
const authenticateWebSocket = () => {
  try {
    const user = getLocalUser();
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      userId: user.id,
      username: user.username,
    };
  } catch (error) {
    console.error('WebSocket local workspace error:', error);
    return null;
  }
};

export {
  DEFAULT_JWT_SECRET,
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  isUsingDefaultJwtSecret,
  JWT_SECRET
};
