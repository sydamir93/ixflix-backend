const db = require("../config/database");
const Genealogy = require("../models/Genealogy");
const Stake = require("../models/Stake");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("../utils/email");
const {
  generateTOTPSecret,
  generateQRCode,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  markBackupCodeAsUsed,
  generateReferralCode,
} = require("../utils/auth");
const { generateToken, generateTempToken } = require("../utils/jwt");
const { auth, security, error, logger } = require("../utils/logger");

/**
 * Login with phone number and password
 */
async function login(req, res) {
  try {
    const { phoneNumber, password } = req.body;

    // Note: Input validation is now handled by middleware
    // Find user
    const user = await db("users").where({ phone_number: phoneNumber }).first();

    if (!user) {
      auth.loginFailure(
        phoneNumber,
        req.ip,
        req.headers["user-agent"],
        "user_not_found"
      );
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      // Log failed attempt
      await db("login_history").insert({
        user_id: user.id,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
        is_successful: false,
        failure_reason: "Invalid password",
      });

      auth.loginFailure(
        phoneNumber,
        req.ip,
        req.headers["user-agent"],
        "invalid_password"
      );
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password",
      });
    }

    // Check if user has 2FA enabled
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: user.id, is_enabled: true })
      .first();

    if (twoFactor) {
      // Generate temporary token for 2FA verification
      const tempToken = generateTempToken(user.id, phoneNumber);

      return res.json({
        success: true,
        requiresTOTP: true,
        tempToken,
        message: "Please verify with authenticator code",
      });
    }

    // Generate access token
    const token = generateToken(user.id, {
      phoneNumber: user.phone_number,
      role: user.role,
      referralCode: user.referral_code,
    });

    // Log successful login
    await db("login_history").insert({
      user_id: user.id,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
      is_successful: true,
    });

    auth.loginSuccess(user.id, req.ip, req.headers["user-agent"]);

    // Check 2FA status (even if not required for this login)
    const twoFactorStatus = await db("two_factor_auth")
      .where({ user_id: user.id, is_enabled: true })
      .first();

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referral_code,
        has2FA: !!twoFactorStatus,
      },
    });
  } catch (err) {
    error("Login error", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
}

/**
 * Register new user
 */
async function register(req, res) {
  try {
    const { phoneNumber, password, name, email, referralCode } = req.body;

    // Note: Input validation is now handled by middleware
    // Check if email already exists (this check remains here as it requires DB access)
    const existingEmailUser = await db("users").where({ email: email }).first();
    if (existingEmailUser) {
      auth.registrationFailure(email, req.ip, "email_already_exists");
      return res.status(409).json({
        success: false,
        message:
          "Email address is already registered. Please use a different email.",
      });
    }

    // Check if user already exists
    const existingUser = await db("users")
      .where({ phone_number: phoneNumber })
      .first();
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Account already exists. Please login instead.",
      });
    }

    console.log("Looking for sponsor with code:", referralCode);

    // Find sponsor by referral code
    let sponsorUser = null;
    try {
      sponsorUser = await db("users")
        .where("referral_code", referralCode)
        .select("id", "name")
        .first();
      console.log("Sponsor user found:", sponsorUser);
    } catch (dbError) {
      console.error("Database error finding sponsor:", dbError);
      // Continue with fallback logic
    }

    // If no sponsor found, create a fallback for testing
    if (!sponsorUser) {
      console.log(
        "No sponsor found, looking for any existing user as fallback..."
      );

      // Try to find any existing active user to use as sponsor
      try {
        sponsorUser = await db("users")
          .where("is_verified", true)
          .select("id", "name", "referral_code")
          .first();

        if (sponsorUser) {
          console.log("Using existing user as fallback sponsor:", sponsorUser);
        } else {
          console.log("No existing users found, will create as root user");
        }
      } catch (dbError) {
        console.error("Database error finding fallback sponsor:", dbError);
        console.log("Will proceed with root user creation");
      }
    }

    // Generate unique referral code for new user
    let userReferralCode;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      userReferralCode = generateReferralCode();
      const existingReferralCode = await db("users")
        .where({ referral_code: userReferralCode })
        .first();
      if (!existingReferralCode) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      error("Could not generate unique referral code after max attempts", {
        attempts,
      });
      return res.status(500).json({
        success: false,
        message: "Failed to generate referral code. Please try again.",
      });
    }

    // Find the next available position
    let position = null;
    let parentId = null;

    if (sponsorUser) {
      // Find the next available position under the sponsor (prioritizing sponsor's positions)
      console.log("Finding position under sponsor:", sponsorUser.id);
      const sponsorPositionData =
        await Genealogy.getNextAvailablePositionUnderSponsor(sponsorUser.id);

      position = sponsorPositionData.position;
      parentId = sponsorPositionData.parentId;
      console.log("Sponsor placement result:", { position, parentId });
    }

    // If no position found or no sponsor, create as root user
    if (!position && !parentId) {
      console.log(
        "Creating as root user (no sponsor or no position available)"
      );
      position = null;
      parentId = null;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get parent user details if different from sponsor and not null
    let parentUser = null;
    if (parentId && parentId !== (sponsorUser ? sponsorUser.id : null)) {
      try {
        parentUser = await db("users")
          .where("id", parentId)
          .select("id", "name", "referral_code")
          .first();
        console.log("Parent user details:", parentUser);
      } catch (dbError) {
        console.error("Error fetching parent user:", dbError);
      }
    }

    // Use database transaction for atomicity
    const result = await db.transaction(async (trx) => {
      // Create user
      const userData = {
        phone_number: phoneNumber,
        password: hashedPassword,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        referral_code: userReferralCode,
        is_verified: true, // Auto-verify since we're using password
        phone_verified_at: new Date(),
      };

      const insertResult = await trx("users").insert(userData);
      const userId = Array.isArray(insertResult)
        ? insertResult[0]
        : insertResult;

      // Create genealogy record
      const genealogyData = {
        user_id: userId,
        parent_id: parentId, // null for root users
        sponsor_id: sponsorUser ? sponsorUser.id : userId, // self-sponsored for root users
        position: position, // null for root users
      };

      await trx("genealogy").insert(genealogyData);

      // Create wallet for the new user
      await trx("wallets").insert({
        user_id: userId,
        balance: 0,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      return {
        userId,
        referralCode: userReferralCode,
        position: position,
        parentId: parentId,
        sponsor: sponsorUser || null,
      };
    });

    // Generate access token
    const token = generateToken(result.userId, {
      phoneNumber: phoneNumber,
      role: "user",
      referralCode: result.referralCode,
    });

    // Get user data
    const user = await db("users").where({ id: result.userId }).first();

    // Log registration
    await db("login_history").insert({
      user_id: result.userId,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
      is_successful: true,
    });

    auth.registrationSuccess(result.userId, user.email, req.ip);

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referral_code,
        has2FA: false,
      },
      genealogy: {
        parent: parentUser
          ? {
              id: parentUser.id,
              name: parentUser.name,
              referral_code: parentUser.referral_code,
            }
          : result.parentId
          ? {
              id: result.parentId,
              name: result.sponsor.name, // If parent is sponsor, use sponsor details
              referral_code: referralCode,
            }
          : null, // null for root users
        sponsor: sponsorUser
          ? {
              id: sponsorUser.id,
              name: sponsorUser.name,
              referral_code: sponsorUser.referral_code || referralCode,
            }
          : null, // null for root users without sponsors
        position: result.position, // null for root users
      },
      shouldSetup2FA: true, // Prompt user to setup 2FA
    });
  } catch (err) {
    error("Registration error", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      email: req.body?.email,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to register",
    });
  }
}

// verifyOTP function removed - no longer needed

/**
 * Verify TOTP code (during login or when authenticated)
 */
async function verifyTOTPCode(req, res) {
  try {
    const { totpCode, tempToken } = req.body;
    let userId;

    if (!totpCode) {
      return res.status(400).json({
        success: false,
        message: "TOTP code is required",
      });
    }

    // Get userId either from tempToken (during login) or from authenticated user
    if (tempToken) {
      // Verify temp token during login flow
      try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
        if (decoded.type !== "temp") {
          return res.status(401).json({
            success: false,
            message: "Invalid token",
          });
        }
        userId = decoded.userId;
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
        });
      }
    } else if (req.user) {
      // Already authenticated (for testing or re-verification)
      userId = req.user.id;
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get user's TOTP secret
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId, is_enabled: true })
      .first();

    if (!twoFactor) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled",
      });
    }

    // Verify TOTP code
    const isValid = verifyTOTP(twoFactor.secret, totpCode);

    if (!isValid) {
      // Log failed attempt
      await db("login_history").insert({
        user_id: userId,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
        is_successful: false,
        failure_reason: "Invalid TOTP code",
      });

      auth.twoFactorVerificationFailure(userId, "totp", req.ip, "invalid_code");

      return res.status(400).json({
        success: false,
        message: "Invalid authenticator code",
      });
    }

    // Get user
    const user = await db("users").where({ id: userId }).first();

    // Generate access token
    const token = generateToken(user.id, {
      phoneNumber: user.phone_number,
      role: user.role,
      referralCode: user.referral_code,
    });

    // Log successful login
    await db("login_history").insert({
      user_id: userId,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
      is_successful: true,
    });

    auth.twoFactorVerificationSuccess(userId, "totp", req.ip);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referral_code,
        has2FA: true,
      },
    });
  } catch (err) {
    error("TOTP verification error", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userId: req.user?.id,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
}

/**
 * Verify backup code (during login or when authenticated)
 */
async function verifyBackupCodeEndpoint(req, res) {
  try {
    const { backupCode, tempToken } = req.body;
    let userId;

    if (!backupCode) {
      return res.status(400).json({
        success: false,
        message: "Backup code is required",
      });
    }

    // Get userId either from tempToken (during login flow) or from authenticated user
    if (tempToken) {
      // Verify temp token during login flow
      try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
        if (decoded.type !== "temp") {
          return res.status(401).json({
            success: false,
            message: "Invalid token",
          });
        }
        userId = decoded.userId;
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
        });
      }
    } else if (req.user) {
      // Already authenticated (for testing or re-verification)
      userId = req.user.id;
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Check if user has 2FA enabled
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId, is_enabled: true })
      .first();

    if (!twoFactor) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled for this account",
      });
    }

    // Verify backup code
    const isValid = await verifyBackupCode(db, userId, backupCode);

    if (!isValid) {
      // Log failed attempt
      await db("login_history").insert({
        user_id: userId,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
        is_successful: false,
        failure_reason: "Invalid backup code",
      });

      auth.twoFactorVerificationFailure(
        userId,
        "backup_code",
        req.ip,
        "invalid_code"
      );

      return res.status(400).json({
        success: false,
        message: "Invalid backup code",
      });
    }

    // Mark backup code as used
    await markBackupCodeAsUsed(db, userId, backupCode);

    auth.backupCodeUsed(userId, req.ip);

    // Get user
    const user = await db("users").where({ id: userId }).first();

    // Generate access token
    const token = generateToken(user.id, {
      phoneNumber: user.phone_number,
      role: user.role,
      referralCode: user.referral_code,
    });

    // Log successful login
    await db("login_history").insert({
      user_id: userId,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
      is_successful: true,
    });

    auth.twoFactorVerificationSuccess(userId, "backup_code", req.ip);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referral_code,
        has2FA: true,
      },
    });
  } catch (err) {
    error("Backup code verification error", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userId: req.user?.id,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
}

/**
 * Setup TOTP (2FA)
 */
async function setupTOTP(req, res) {
  try {
    const userId = req.user.id;

    // Get user to ensure we have correct phone number
    const user = await db("users").where({ id: userId }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if 2FA is already enabled
    const existing = await db("two_factor_auth")
      .where({ user_id: userId })
      .first();

    if (existing && existing.is_enabled) {
      return res.status(400).json({
        success: false,
        message: "2FA is already enabled",
      });
    }

    // Generate secret
    const secret = generateTOTPSecret();

    // Generate QR code with user's phone number
    const qrCode = await generateQRCode(secret, user.phone_number);

    // Save secret (not enabled yet) - handle both insert and update
    // Use raw SQL for MySQL upsert since Knex doesn't support onConflict for MySQL
    await db.raw(
      `
      INSERT INTO two_factor_auth (user_id, secret, is_enabled, enabled_at)
      VALUES (?, ?, false, NULL)
      ON DUPLICATE KEY UPDATE
        secret = ?,
        is_enabled = false,
        enabled_at = NULL
    `,
      [userId, secret, secret]
    );

    res.json({
      success: true,
      secret,
      qrCode,
    });
  } catch (err) {
    error("Setup TOTP error", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to setup 2FA",
    });
  }
}

/**
 * Enable TOTP (2FA)
 */
async function enableTOTP(req, res) {
  try {
    const { totpCode } = req.body;
    const userId = req.user.id;

    if (!totpCode) {
      return res.status(400).json({
        success: false,
        message: "TOTP code is required",
      });
    }

    // Get TOTP secret
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId })
      .first();

    if (!twoFactor) {
      return res.status(400).json({
        success: false,
        message: "2FA setup not found. Please setup first.",
      });
    }

    // Verify code
    const isValid = verifyTOTP(twoFactor.secret, totpCode);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid code. Please try again.",
      });
    }

    // Enable 2FA
    await db("two_factor_auth").where({ user_id: userId }).update({
      is_enabled: true,
      enabled_at: new Date(),
    });

    auth.twoFactorEnabled(userId, req.ip);

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);

    // Save hashed backup codes (normalize before hashing for consistency)
    for (const code of backupCodes) {
      const normalizedCode = code.replace(/[\s\-]+/g, "").toUpperCase();
      await db("backup_codes").insert({
        user_id: userId,
        code: hashBackupCode(normalizedCode),
      });
    }

    res.json({
      success: true,
      message: "2FA enabled successfully",
      backupCodes,
    });
  } catch (err) {
    error("Enable TOTP error", {
      error: err.message,
      stack: err.stack,
      userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to enable 2FA",
    });
  }
}

/**
 * Disable TOTP (2FA)
 */
async function disableTOTP(req, res) {
  try {
    const { totpCode } = req.body;
    const userId = req.user.id;

    if (!totpCode) {
      return res.status(400).json({
        success: false,
        message: "TOTP code is required",
      });
    }

    // Get TOTP secret
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId, is_enabled: true })
      .first();

    if (!twoFactor) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled",
      });
    }

    // Verify code
    const isValid = verifyTOTP(twoFactor.secret, totpCode);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid code",
      });
    }

    // Disable 2FA
    await db("two_factor_auth").where({ user_id: userId }).update({
      is_enabled: false,
      enabled_at: null,
    });

    // Delete backup codes
    await db("backup_codes").where({ user_id: userId }).delete();

    auth.twoFactorDisabled(userId, req.ip);

    res.json({
      success: true,
      message: "2FA disabled successfully",
    });
  } catch (err) {
    error("Disable 2FA error", {
      error: err.message,
      stack: err.stack,
      userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to disable 2FA",
    });
  }
}

/**
 * Update profile (name/email)
 */
async function updateProfile(req, res) {
  const userId = req.user.id;
  const { name, email } = req.body;

  try {
    const updates = {};

    if (name) {
      updates.name = name;
    }

    if (email) {
      // Ensure email uniqueness
      const existingEmailUser = await db("users")
        .where({ email })
        .andWhereNot({ id: userId })
        .first();
      if (existingEmailUser) {
        return res.status(409).json({
          success: false,
          message: "Email address is already in use by another account",
        });
      }
      updates.email = email;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No changes provided",
      });
    }

    await db("users")
      .where({ id: userId })
      .update({ ...updates, updated_at: new Date() });

    // Fetch updated user data
    const user = await db("users").where({ id: userId }).first();
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId, is_enabled: true })
      .first();

    security.info("User profile updated", {
      userId,
      updates: Object.keys(updates),
      ip: req.ip,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referral_code,
        has2FA: !!twoFactor,
        isVerified: user.is_verified,
      },
    });
  } catch (err) {
    error("Update profile error", {
      error: err.message,
      stack: err.stack,
      userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
}

/**
 * Request password reset (sends email)
 */
async function requestPasswordReset(req, res) {
  const { email } = req.body;
  const genericMessage =
    "If an account with that email exists, a reset link has been sent.";

  try {
    const user = await db("users").where({ email }).first();

    // Always return generic success to avoid enumeration
    if (!user) {
      security.info("Password reset requested for unknown email", {
        email,
        ip: req.ip,
      });
      return res.json({ success: true, message: genericMessage });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const ttlMinutes = parseInt(
      process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || "60",
      10
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await db.transaction(async (trx) => {
      // Clean up existing unused tokens for the user
      await trx("password_reset_tokens")
        .where({ user_id: user.id, used_at: null })
        .delete();

      await trx("password_reset_tokens").insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    });

    const resetBaseUrl =
      process.env.PASSWORD_RESET_URL ||
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password`;
    const resetLink = `${resetBaseUrl}${
      resetBaseUrl.includes("?") ? "&" : "?"
    }token=${token}`;

    await sendPasswordResetEmail(
      user.email,
      user.name || user.phone_number,
      resetLink
    );

    logger.info("Password reset requested", {
      userId: user.id,
      email: user.email,
      event: "password_reset_requested",
      ip: req.ip,
      meta: { type: "security" },
    });

    res.json({ success: true, message: genericMessage });
  } catch (err) {
    error("Password reset request error", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      email,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Unable to process reset request",
    });
  }
}

/**
 * Reset password with token
 */
async function resetPassword(req, res) {
  const { token, newPassword } = req.body;

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRecord = await db("password_reset_tokens")
      .where({ token_hash: tokenHash })
      .first();

    if (!tokenRecord || tokenRecord.used_at) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset link",
      });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Reset link has expired",
      });
    }

    const user = await db("users").where({ id: tokenRecord.user_id }).first();
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset request",
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await db.transaction(async (trx) => {
      await trx("users")
        .where({ id: user.id })
        .update({ password: hashed, updated_at: new Date() });

      await trx("password_reset_tokens")
        .where({ id: tokenRecord.id })
        .update({ used_at: new Date(), updated_at: new Date() });

      // Clean up any other tokens for this user
      await trx("password_reset_tokens")
        .where({ user_id: user.id })
        .andWhereNot({ id: tokenRecord.id })
        .delete();
    });

    logger.info("Password reset completed", {
      userId: user.id,
      event: "password_reset_completed",
      ip: req.ip,
      meta: { type: "security" },
    });

    res.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (err) {
    error("Password reset error", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  }
}

/**
 * Change password
 */
async function changePassword(req, res) {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  try {
    const user = await db("users").where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash and update password
    const hashed = await bcrypt.hash(newPassword, 10);
    await db("users")
      .where({ id: userId })
      .update({ password: hashed, updated_at: new Date() });

    logger.info("User password changed", {
      userId,
      event: "password_change",
      ip: req.ip,
      meta: { type: "security" },
    });

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    error("Change password error", {
      error: err.message,
      stack: err.stack,
      userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
}

/**
 * Get current user
 */
async function getCurrentUser(req, res) {
  try {
    const userId = req.user.id;

    const user = await db("users").where({ id: userId }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if 2FA is enabled
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId, is_enabled: true })
      .first();

    res.json({
      success: true,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referral_code,
        has2FA: !!twoFactor,
        isVerified: user.is_verified,
      },
    });
  } catch (err) {
    error("Get current user error", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
}

/**
 * Count all downlines recursively
 */
async function countAllDownlines(sponsorId, visited = new Set()) {
  if (visited.has(sponsorId)) return 0; // Prevent infinite loops
  visited.add(sponsorId);

  const directDownlines = await db("genealogy")
    .where({ sponsor_id: sponsorId })
    .select("user_id");

  let totalCount = directDownlines.length;

  // Recursively count downlines for each direct downline
  for (const downline of directDownlines) {
    totalCount += await countAllDownlines(downline.user_id, visited);
  }

  return totalCount;
}

/**
 * Get referral stats for current user
 */
async function getReferralStats(req, res) {
  try {
    const userId = req.user.id;

    // Get direct referrals count
    const directReferrals = await db("genealogy")
      .where({ sponsor_id: userId })
      .count("id as count")
      .first();

    // Get total network size (all downlines recursively)
    const totalNetworkSize = await countAllDownlines(userId);

    // For now, active team investment and total earnings are placeholders
    // In a real system, these would be calculated from investment/transaction tables

    res.json({
      success: true,
      stats: {
        totalReferrals: totalNetworkSize, // Now shows entire network size
        directReferrals: parseInt(directReferrals.count) || 0, // Direct referrals count
        activeTeamInvestment: 0, // Placeholder - would count active investments
        totalTeamInvestment: 0, // Placeholder - would sum investment amounts
        totalEarnings: 0, // Placeholder - would calculate earnings
      },
    });
  } catch (err) {
    error("Get referral stats error", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to get referral stats",
    });
  }
}

/**
 * Build hierarchical genealogy tree by sponsor (sponsor_id)
 * No depth limit - builds complete tree
 */
async function buildGenealogyTree(
  sponsorId,
  currentDepth = 0,
  visited = new Set()
) {
  // Prevent cycles / self-references
  if (visited.has(sponsorId)) return [];
  visited.add(sponsorId);

  // Get direct downlines for this sponsor
  const downlines = await db("genealogy as g")
    .join("users as u", "g.user_id", "u.id")
    .leftJoin("user_ranks as r", "u.id", "r.user_id")
    .where("g.sponsor_id", sponsorId)
    .andWhereNot("g.user_id", sponsorId) // avoid self-linked seed rows
    .select(
      "u.id",
      "u.name",
      "u.email",
      "u.phone_number",
      "u.created_at",
      "g.position",
      "g.created_at as joined_at",
      "r.rank",
      "r.override_percent"
    )
    .orderBy("g.created_at", "desc");

  // Add stake information for each downline
  const downlinesWithStakes = await Promise.all(
    downlines.map(async (downline) => {
      const stakeInfo = await Stake.getUserActivePackInfo(downline.id);
      return {
        ...downline,
        stake_pack: stakeInfo.highestPack,
        stake_amount: stakeInfo.totalAmount,
      };
    })
  );

  // Recursively build tree for each downline
  const tree = await Promise.all(
    downlinesWithStakes.map(async (downline) => ({
      id: downline.id,
      name: downline.name,
      email: downline.email,
      phone_number: downline.phone_number,
      position: downline.position,
      joined_at: downline.joined_at,
      rank: downline.rank || "unranked",
      rank_percent: downline.override_percent || 0,
      stake_pack: downline.stake_pack,
      stake_amount: downline.stake_amount,
      children: await buildGenealogyTree(
        downline.id,
        currentDepth + 1,
        new Set(visited)
      ),
    }))
  );

  return tree;
}

/**
 * Build hierarchical placement tree by parent (parent_id and position)
 * Binary tree structure based on placement
 * No depth limit - builds complete tree
 */
async function buildPlacementTree(
  parentId,
  currentDepth = 0,
  visited = new Set()
) {
  // Prevent cycles
  if (visited.has(parentId)) return [];
  visited.add(parentId);

  // Get direct children (left and right) for this parent
  const children = await db("genealogy as g")
    .join("users as u", "g.user_id", "u.id")
    .leftJoin("user_ranks as r", "u.id", "r.user_id")
    .where("g.parent_id", parentId)
    .select(
      "u.id",
      "u.name",
      "u.email",
      "u.phone_number",
      "u.created_at",
      "g.position",
      "g.created_at as joined_at",
      "r.rank",
      "r.override_percent"
    )
    .orderBy("g.position", "asc") // left before right
    .orderBy("g.created_at", "asc");

  // Add stake information for each child
  const childrenWithStakes = await Promise.all(
    children.map(async (child) => {
      const stakeInfo = await Stake.getUserActivePackInfo(child.id);
      return {
        ...child,
        stake_pack: stakeInfo.highestPack,
        stake_amount: stakeInfo.totalAmount,
      };
    })
  );

  // Recursively build tree for each child
  const tree = await Promise.all(
    childrenWithStakes.map(async (child) => ({
      id: child.id,
      name: child.name,
      email: child.email,
      phone_number: child.phone_number,
      position: child.position,
      joined_at: child.joined_at,
      rank: child.rank || "unranked",
      rank_percent: child.override_percent || 0,
      stake_pack: child.stake_pack,
      stake_amount: child.stake_amount,
      children: await buildPlacementTree(
        child.id,
        currentDepth + 1,
        new Set(visited)
      ),
    }))
  );

  return tree;
}

/**
 * Get genealogy/downlines for current user (full tree)
 * Supports two types: 'sponsor' (by sponsor_id) or 'placement' (by parent_id)
 */
async function getGenealogy(req, res) {
  try {
    const userId = req.user.id;
    const treeType = req.query.type || "sponsor"; // Default to 'sponsor' for backward compatibility

    let genealogyTree;

    if (treeType === "placement") {
      // Build placement tree based on parent_id (binary tree)
      genealogyTree = await buildPlacementTree(userId);
    } else {
      // Build sponsor tree based on sponsor_id (default)
      genealogyTree = await buildGenealogyTree(userId);
    }

    res.json({
      success: true,
      genealogy: genealogyTree,
      type: treeType,
    });
  } catch (err) {
    error("Get genealogy error", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to get genealogy",
    });
  }
}

/**
 * Logout
 */
async function logout(req, res) {
  try {
    auth.logout(req.user?.id, req.ip);

    // In a more complex system, you might want to invalidate the token
    // For now, we just return success
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    error("Logout error", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
}

/**
 * Regenerate backup codes
 */
async function regenerateBackupCodes(req, res) {
  try {
    const userId = req.user.id;

    // Check if user has 2FA enabled
    const twoFactor = await db("two_factor_auth")
      .where({ user_id: userId, is_enabled: true })
      .first();

    if (!twoFactor) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled for this account",
      });
    }

    // Delete existing unused backup codes
    await db("backup_codes")
      .where({ user_id: userId, is_used: false })
      .delete();

    // Generate new backup codes
    const backupCodes = generateBackupCodes(10);

    // Save hashed backup codes (normalize before hashing for consistency)
    for (const code of backupCodes) {
      const normalizedCode = code.replace(/[\s\-]+/g, "").toUpperCase();
      await db("backup_codes").insert({
        user_id: userId,
        code: hashBackupCode(normalizedCode),
      });
    }

    auth.backupCodesRegenerated(userId, req.ip);

    res.json({
      success: true,
      message: "Backup codes regenerated successfully",
      backupCodes,
    });
  } catch (err) {
    error("Regenerate backup codes error", {
      error: err.message,
      stack: err.stack,
      userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(500).json({
      success: false,
      message: "Failed to regenerate backup codes",
    });
  }
}

module.exports = {
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
  logout,
};
