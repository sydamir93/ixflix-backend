const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { security } = require('../utils/logger');
const {
  validateRegistration,
  validateLogin,
  validateTOTPVerification,
  validateBackupCodeVerification,
  validateTOTPSetup,
  validateTOTPEnable,
  validateTOTPDisable,
  validateProfileUpdate,
  validatePasswordChange,
  validateForgotPasswordRequest,
  validatePasswordReset,
  sanitizeInput
} = require('../middleware/validation');

// 2FA verification rate limiter - very restrictive for login verification
const twoFactorLimiter = rateLimit({
  windowMs: (parseInt(process.env.TWO_FA_VERIFICATION_WINDOW) || 15) * 60 * 1000,
  max: parseInt(process.env.TWO_FA_VERIFICATION_MAX_ATTEMPTS) || 5,
  message: {
    success: false,
    message: 'Too many 2FA verification attempts. Please try again in 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP address for rate limiting
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

// 2FA management rate limiter - moderate restriction for authenticated users
const twoFactorManagementLimiter = rateLimit({
  windowMs: (parseInt(process.env.TWO_FA_MANAGEMENT_WINDOW) || 5) * 60 * 1000,
  max: parseInt(process.env.TWO_FA_MANAGEMENT_MAX_ATTEMPTS) || 10,
  message: {
    success: false,
    message: 'Too many 2FA management attempts. Please try again in a few minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use user ID for rate limiting (more permissive for authenticated users)
  keyGenerator: (req) => {
    return req.user?.id || req.ip;
  }
});

// Password reset limiter - protects public email endpoint
const passwordResetLimiter = rateLimit({
  windowMs: (parseInt(process.env.PASSWORD_RESET_WINDOW_MINUTES) || 15) * 60 * 1000,
  max: parseInt(process.env.PASSWORD_RESET_MAX_REQUESTS) || 5,
  message: {
    success: false,
    message: 'Too many password reset attempts. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection.remoteAddress
});
const {
  register,
  login,
  verifyTOTPCode,
  verifyBackupCodeEndpoint,
  setupTOTP,
  enableTOTP,
  disableTOTP,
  regenerateBackupCodes,
  updateProfile,
  requestPasswordReset,
  resetPassword,
  changePassword,
  getCurrentUser,
  getReferralStats,
  getGenealogy,
  logout
} = require('../controllers/authController');
const rankController = require('../controllers/rankController');

// Public routes
router.post('/register', sanitizeInput, validateRegistration, register);
router.post('/login', sanitizeInput, validateLogin, login);
router.post('/verify-totp', twoFactorLimiter, sanitizeInput, validateTOTPVerification, verifyTOTPCode); // Public for login flow
router.post('/verify-backup-code', twoFactorLimiter, sanitizeInput, validateBackupCodeVerification, verifyBackupCodeEndpoint); // Public for login flow
router.post('/forgot-password', passwordResetLimiter, sanitizeInput, validateForgotPasswordRequest, requestPasswordReset);
router.post('/reset-password', passwordResetLimiter, sanitizeInput, validatePasswordReset, resetPassword);

// Protected routes
router.post('/totp/setup', authenticate, validateTOTPSetup, setupTOTP);
router.post('/totp/enable', authenticate, twoFactorManagementLimiter, sanitizeInput, validateTOTPEnable, enableTOTP);
router.post('/totp/disable', authenticate, twoFactorManagementLimiter, sanitizeInput, validateTOTPDisable, disableTOTP);
router.post('/totp/regenerate-backup-codes', authenticate, twoFactorManagementLimiter, regenerateBackupCodes);
router.put('/profile', authenticate, sanitizeInput, validateProfileUpdate, updateProfile);
router.post('/change-password', authenticate, sanitizeInput, validatePasswordChange, changePassword);
router.get('/me', authenticate, getCurrentUser);
router.get('/referral-stats', authenticate, getReferralStats);
router.get('/genealogy', authenticate, getGenealogy);
router.post('/logout', authenticate, logout);

// Rank ladder public info
router.get('/rank/ladder', rankController.getRankLadder);

// Rank (requires auth; admin for mutations and other users)
router.get('/rank/me', authenticate, rankController.getMyRank);
router.get('/rank/progress', authenticate, rankController.getMyRankProgress);
router.get('/rank/:user_id', authenticate, rankController.adminGetUserRank);
router.post('/rank/:user_id', authenticate, rankController.adminSetUserRank);
router.post('/rank/:user_id/evaluate', authenticate, rankController.adminEvaluateUser);
router.post('/rank/:user_id/promote', authenticate, rankController.adminAutoPromoteUser);
router.post('/rank/promote-all', authenticate, rankController.adminAutoPromoteAll);

module.exports = router;

