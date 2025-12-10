/**
 * Input Validation and Sanitization Middleware
 * Provides comprehensive validation for API endpoints
 */

const { security } = require('../utils/logger');

/**
 * Sanitize string input
 * @param {string} input - Input string to sanitize
 * @param {object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeString(input, options = {}) {
  if (typeof input !== 'string') return input;

  let sanitized = input;

  // Trim whitespace
  if (options.trim !== false) {
    sanitized = sanitized.trim();
  }

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove control characters (except newlines and tabs if allowed)
  if (options.allowNewlines) {
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  }

  // Basic HTML escaping to prevent XSS
  if (options.escapeHtml !== false) {
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  // Limit length
  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
  }

  return sanitized;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;

  // Basic email regex - more comprehensive than simple check but not as robust as validator
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;

  // Additional checks
  const parts = email.split('@');
  if (parts.length !== 2) return false;

  const [localPart, domainPart] = parts;

  // Local part should not be empty and not start/end with dots
  if (!localPart || localPart.startsWith('.') || localPart.endsWith('.')) return false;

  // Domain part should not be empty and contain at least one dot
  if (!domainPart || !domainPart.includes('.')) return false;

  // Domain should not start or end with dot
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) return false;

  return true;
}

/**
 * Validate phone number (basic validation)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid phone format
 */
function isValidPhoneNumber(phone) {
  if (typeof phone !== 'string') return false;

  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');

  // Check if it has reasonable length (7-15 digits)
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} Validation result with isValid and errors
 */
function validatePassword(password) {
  if (typeof password !== 'string') {
    return { isValid: false, errors: ['Password must be a string'] };
  }

  const errors = [];

  // Minimum length
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  // Maximum length
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters long');
  }

  // Uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Number
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate name
 * @param {string} name - Name to validate
 * @returns {object} Validation result
 */
function validateName(name) {
  if (typeof name !== 'string') {
    return { isValid: false, errors: ['Name must be a string'] };
  }

  const errors = [];
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    errors.push('Name is required');
  } else if (trimmed.length < 2) {
    errors.push('Name must be at least 2 characters long');
  } else if (trimmed.length > 100) {
    errors.push('Name must be less than 100 characters long');
  }

  // Check for potentially malicious patterns
  if (/[<>\"'&]/.test(trimmed)) {
    errors.push('Name contains invalid characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: trimmed
  };
}

/**
 * Validate TOTP code
 * @param {string} code - TOTP code to validate
 * @returns {object} Validation result
 */
function validateTOTPCode(code) {
  if (typeof code !== 'string') {
    return { isValid: false, errors: ['TOTP code must be a string'] };
  }

  const errors = [];
  const sanitized = code.replace(/\s+/g, ''); // Remove spaces

  if (sanitized.length === 0) {
    errors.push('TOTP code is required');
  } else if (!/^\d{6}$/.test(sanitized)) {
    errors.push('TOTP code must be exactly 6 digits');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate backup code
 * @param {string} code - Backup code to validate
 * @returns {object} Validation result
 */
function validateBackupCode(code) {
  if (typeof code !== 'string') {
    return { isValid: false, errors: ['Backup code must be a string'] };
  }

  const errors = [];
  // Normalize the code (remove spaces and hyphens, convert to uppercase)
  const normalizedCode = code.replace(/[\s\-]+/g, '').toUpperCase();

  if (normalizedCode.length === 0) {
    errors.push('Backup code is required');
  } else if (!/^[A-F0-9]{8}$/.test(normalizedCode)) {
    errors.push('Backup code must be 8 hexadecimal characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: normalizedCode
  };
}

/**
 * Validate profile update payload
 */
function validateProfileUpdate(req, res, next) {
  const { name, email } = req.body || {};
  const errors = [];

  if (!name && !email) {
    return res.status(400).json({
      success: false,
      message: 'At least one field (name or email) must be provided'
    });
  }

  if (name) {
    const nameValidation = validateName(name);
    if (!nameValidation.isValid) {
      errors.push(...nameValidation.errors);
    } else {
      req.body.name = nameValidation.sanitized;
    }
  }

  if (email) {
    if (!isValidEmail(email)) {
      errors.push('Please enter a valid email address');
    } else {
      req.body.email = sanitizeString(email.toLowerCase(), { maxLength: 150 });
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid profile data',
      errors
    });
  }

  next();
}

/**
 * Validate password change payload
 */
function validatePasswordChange(req, res, next) {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Current password and new password are required'
    });
  }

  const validation = validatePassword(newPassword);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid new password',
      errors: validation.errors
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      success: false,
      message: 'New password must be different from current password'
    });
  }

  // Basic sanitization (passwords are not altered to avoid changing intent)
  req.body.currentPassword = currentPassword;
  req.body.newPassword = newPassword;
  next();
}

/**
 * Validate forgot password request
 */
function validateForgotPasswordRequest(req, res, next) {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid email address'
    });
  }

  req.body.email = sanitizeString(email.toLowerCase().trim(), { maxLength: 255 });
  next();
}

/**
 * Validate reset password payload
 */
function validatePasswordReset(req, res, next) {
  const { token, newPassword } = req.body || {};

  if (!token || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Token and new password are required'
    });
  }

  const validation = validatePassword(newPassword);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid new password',
      errors: validation.errors
    });
  }

  req.body.token = sanitizeString(token, { maxLength: 256, escapeHtml: false });
  req.body.newPassword = newPassword;
  next();
}

/**
 * Middleware to validate registration data
 */
function validateRegistration(req, res, next) {
  const errors = [];
  const { phoneNumber, password, name, email } = req.body;

  // Validate required fields
  if (!phoneNumber || !password || !name || !email) {
    return res.status(400).json({
      success: false,
      message: 'Phone number, password, name, and email are required'
    });
  }

  // Validate phone number
  if (!isValidPhoneNumber(phoneNumber)) {
    errors.push('Please enter a valid phone number');
  } else {
    req.body.phoneNumber = sanitizeString(phoneNumber, { maxLength: 20 });
  }

  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    errors.push(...passwordValidation.errors);
  }

  // Validate name
  const nameValidation = validateName(name);
  if (!nameValidation.isValid) {
    errors.push(...nameValidation.errors);
  } else {
    req.body.name = nameValidation.sanitized;
  }

  // Validate email
  if (!isValidEmail(email)) {
    errors.push('Please enter a valid email address');
  } else {
    req.body.email = sanitizeString(email.toLowerCase().trim(), { maxLength: 255 });
  }

  if (errors.length > 0) {
    security.inputValidationError('/api/auth/register', 'multiple', JSON.stringify(errors), req.ip);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
}

/**
 * Middleware to validate login data
 */
function validateLogin(req, res, next) {
  const errors = [];
  const { phoneNumber, password } = req.body;

  // Validate required fields
  if (!phoneNumber || !password) {
    return res.status(400).json({
      success: false,
      message: 'Phone number and password are required'
    });
  }

  // Validate phone number
  if (!isValidPhoneNumber(phoneNumber)) {
    errors.push('Please enter a valid phone number');
  } else {
    req.body.phoneNumber = sanitizeString(phoneNumber, { maxLength: 20 });
  }

  // Basic password validation (just length for login)
  if (typeof password !== 'string' || password.length < 1) {
    errors.push('Password is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
}

/**
 * Middleware to validate TOTP verification
 */
function validateTOTPVerification(req, res, next) {
  const { totpCode, tempToken } = req.body;

  if (!totpCode || !tempToken) {
    return res.status(400).json({
      success: false,
      message: 'TOTP code and temporary token are required'
    });
  }

  const codeValidation = validateTOTPCode(totpCode);
  if (!codeValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid TOTP code format',
      errors: codeValidation.errors
    });
  }

  req.body.totpCode = codeValidation.sanitized;
  req.body.tempToken = sanitizeString(tempToken, { maxLength: 500 });

  next();
}

/**
 * Middleware to validate backup code verification
 */
function validateBackupCodeVerification(req, res, next) {
  const { backupCode, tempToken } = req.body;

  if (!backupCode || !tempToken) {
    return res.status(400).json({
      success: false,
      message: 'Backup code and temporary token are required'
    });
  }

  const codeValidation = validateBackupCode(backupCode);
  if (!codeValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid backup code format',
      errors: codeValidation.errors
    });
  }

  req.body.backupCode = codeValidation.sanitized;
  req.body.tempToken = sanitizeString(tempToken, { maxLength: 500 });

  next();
}

/**
 * Middleware to validate TOTP setup
 */
function validateTOTPSetup(req, res, next) {
  // TOTP setup doesn't require body validation as it just generates secrets
  next();
}

/**
 * Middleware to validate TOTP enable
 */
function validateTOTPEnable(req, res, next) {
  const { totpCode } = req.body;

  if (!totpCode) {
    return res.status(400).json({
      success: false,
      message: 'TOTP code is required'
    });
  }

  const codeValidation = validateTOTPCode(totpCode);
  if (!codeValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid TOTP code format',
      errors: codeValidation.errors
    });
  }

  req.body.totpCode = codeValidation.sanitized;
  next();
}

/**
 * Middleware to validate TOTP disable
 */
function validateTOTPDisable(req, res, next) {
  const { totpCode } = req.body;

  if (!totpCode) {
    return res.status(400).json({
      success: false,
      message: 'TOTP code is required'
    });
  }

  const codeValidation = validateTOTPCode(totpCode);
  if (!codeValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid TOTP code format',
      errors: codeValidation.errors
    });
  }

  req.body.totpCode = codeValidation.sanitized;
  next();
}

/**
 * General input sanitization middleware
 * Sanitizes all string inputs in req.body
 */
function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        // Apply basic sanitization to all string inputs
        req.body[key] = sanitizeString(value, {
          maxLength: 1000, // Reasonable default max length
          escapeHtml: true
        });
      }
    }
  }

  next();
}

module.exports = {
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
  sanitizeInput,
  // Utility functions for use in controllers
  sanitizeString,
  isValidEmail,
  isValidPhoneNumber,
  validatePassword,
  validateName,
  validateTOTPCode,
  validateBackupCode
};
