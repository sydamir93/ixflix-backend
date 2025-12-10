const jwt = require('jsonwebtoken');
const db = require('../config/database');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
async function authenticate(req, res, next) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const user = await db('users')
      .where({ id: decoded.userId })
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is disabled'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      phoneNumber: user.phone_number,
      email: user.email,
      name: user.name,
      role: user.role || decoded.role || 'user',
      referralCode: user.referral_code
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't require authentication
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const user = await db('users')
        .where({ id: decoded.userId })
        .first();

      if (user && user.is_active) {
        req.user = {
          id: user.id,
          phoneNumber: user.phone_number,
          email: user.email,
          name: user.name,
          role: user.role || decoded.role || 'user',
          referralCode: user.referral_code
        };
      }
    }

    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
}

/**
 * Authorization middleware for admin-only routes
 */
function authorizeAdmin(req, res, next) {
  // authenticate should already have run and attached the user
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  next();
}

module.exports = {
  authenticate,
  optionalAuth,
  authorizeAdmin
};

