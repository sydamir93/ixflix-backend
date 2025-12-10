const jwt = require('jsonwebtoken');

/**
 * Generate JWT access token
 */
function generateToken(userId, additionalData = {}) {
  return jwt.sign(
    {
      userId,
      ...additionalData
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * Generate temporary token (for 2FA flow)
 */
function generateTempToken(userId, phoneNumber) {
  return jwt.sign(
    { userId, phoneNumber, type: 'temp' },
    process.env.JWT_SECRET,
    { expiresIn: '30m' } // Increased to 30 minutes
  );
}

/**
 * Verify token
 */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = {
  generateToken,
  generateTempToken,
  verifyToken
};

