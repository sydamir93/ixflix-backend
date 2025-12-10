const crypto = require('crypto');
const { encode: base32Encode } = require('hi-base32');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

/**
 * Validate password strength
 * Requirements: min 8 chars, uppercase, lowercase, number, special character
 */
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      errors: ['Password is required']
    };
  }

  const errors = [];

  // Minimum length
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  // Maximum length (reasonable limit)
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
 * Generate random OTP
 */
function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';

  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }

  return otp;
}

/**
 * Generate TOTP secret
 */
function generateTOTPSecret() {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer).replace(/=/g, '');
}

/**
 * Generate QR code for TOTP
 */
async function generateQRCode(secret, phoneNumber) {
  const issuer = process.env.TOTP_ISSUER || 'IXFLIX';
  
  // Format phone number - keep it as is for the label
  // The otpauth URL format is: otpauth://totp/ISSUER:ACCOUNT?secret=...
  // Where ACCOUNT is what shows up in the authenticator app
  // We'll use the full phone number as the account identifier
  const accountLabel = phoneNumber; // Use phone number as account identifier
  
  const otpauth = speakeasy.otpauthURL({
    secret,
    label: accountLabel, // This will be shown as "IXFLIX: +60162167517" in authenticator
    issuer: issuer,
    encoding: 'base32',
    algorithm: 'sha1'
  });


  return await QRCode.toDataURL(otpauth);
}

/**
 * Verify TOTP code
 */
function verifyTOTP(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: parseInt(process.env.TOTP_WINDOW) || 1
  });
}

/**
 * Generate backup codes
 */
function generateBackupCodes(count = 10) {
  const codes = [];
  
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    codes.push(formatted);
  }
  
  return codes;
}

/**
 * Hash backup code for storage
 */
function hashBackupCode(code) {
  return crypto
    .createHash('sha256')
    .update(code)
    .digest('hex');
}

/**
 * Verify backup code
 * Checks if the provided code matches any unused backup code for the user
 */
async function verifyBackupCode(db, userId, code) {
  // Normalize the code (remove spaces and hyphens, convert to uppercase)
  const normalizedCode = code.replace(/[\s\-]+/g, '').toUpperCase();

  // Validate format (should be 8 hexadecimal characters)
  if (!/^[A-F0-9]{8}$/.test(normalizedCode)) {
    return false;
  }

  // Hash the provided code
  const hashedCode = hashBackupCode(normalizedCode);

  // Find matching backup code that hasn't been used
  const backupCode = await db('backup_codes')
    .where({
      user_id: userId,
      code: hashedCode,
      is_used: false
    })
    .first();

  return !!backupCode;
}

/**
 * Mark backup code as used
 */
async function markBackupCodeAsUsed(db, userId, code) {
  // Normalize the code (remove spaces and hyphens, convert to uppercase)
  const normalizedCode = code.replace(/[\s\-]+/g, '').toUpperCase();

  // Hash the normalized code
  const hashedCode = hashBackupCode(normalizedCode);

  // Mark as used
  await db('backup_codes')
    .where({
      user_id: userId,
      code: hashedCode
    })
    .update({
      is_used: true,
      used_at: new Date()
    });
}

/**
 * Generate unique referral code
 * Format: IX- followed by 9 random digits (e.g., IX-466405446)
 */
function generateReferralCode() {
  const randomDigits = Math.floor(100000000 + Math.random() * 900000000).toString();
  return `IX-${randomDigits}`;
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
function validatePasswordStrength(password) {
  const errors = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  generateOTP,
  generateTOTPSecret,
  generateQRCode,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCode,
  validatePasswordStrength,
  verifyBackupCode,
  markBackupCodeAsUsed,
  generateReferralCode
};

