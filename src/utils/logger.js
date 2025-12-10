const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Define log format for development
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}${
      info.stack ? `\n${info.stack}` : ''
    }${info.meta ? `\n${JSON.stringify(info.meta, null, 2)}` : ''}`
  )
);

// Define log format for production
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const logEntry = {
      timestamp: info.timestamp,
      level: info.level,
      message: info.message,
      service: 'ixflix-backend',
      ...info.meta
    };

    if (info.stack) {
      logEntry.stack = info.stack;
    }

    return JSON.stringify(logEntry);
  })
);

// Create winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels,
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    // Write all logs with importance level of `error` or less to `error.log`
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with importance level of `info` or less to `combined.log`
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// If we're not in production, log to the console with the dev format
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: devFormat,
  }));
}

// Create a logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger utility functions with structured logging
const loggerUtils = {
  // Request logging middleware
  requestLogger: (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const userId = req.user?.id || 'anonymous';
      const ip = req.ip || req.connection.remoteAddress;

      logger.http('Request completed', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        userId,
        ip,
        userAgent: req.get('User-Agent'),
        meta: {
          requestId: req.headers['x-request-id'] || 'unknown',
          contentLength: res.get('Content-Length') || 0
        }
      });
    });

    next();
  },

  // Authentication logging
  auth: {
    loginSuccess: (userId, ip, userAgent) => {
      logger.info('User login successful', {
        userId,
        event: 'login_success',
        ip,
        userAgent,
        meta: { type: 'authentication' }
      });
    },

    loginFailure: (phoneNumber, ip, userAgent, reason) => {
      logger.warn('User login failed', {
        phoneNumber,
        event: 'login_failure',
        reason,
        ip,
        userAgent,
        meta: { type: 'authentication' }
      });
    },

    logout: (userId, ip) => {
      logger.info('User logout', {
        userId,
        event: 'logout',
        ip,
        meta: { type: 'authentication' }
      });
    },

    registrationSuccess: (userId, email, ip) => {
      logger.info('User registration successful', {
        userId,
        email,
        event: 'registration_success',
        ip,
        meta: { type: 'authentication' }
      });
    },

    registrationFailure: (email, ip, reason) => {
      logger.warn('User registration failed', {
        email,
        event: 'registration_failure',
        reason,
        ip,
        meta: { type: 'authentication' }
      });
    },

    twoFactorEnabled: (userId, ip) => {
      logger.info('2FA enabled', {
        userId,
        event: '2fa_enabled',
        ip,
        meta: { type: 'security' }
      });
    },

    twoFactorDisabled: (userId, ip) => {
      logger.info('2FA disabled', {
        userId,
        event: '2fa_disabled',
        ip,
        meta: { type: 'security' }
      });
    },

    twoFactorVerificationSuccess: (userId, method, ip) => {
      logger.info('2FA verification successful', {
        userId,
        method, // 'totp' or 'backup_code'
        event: '2fa_verification_success',
        ip,
        meta: { type: 'security' }
      });
    },

    twoFactorVerificationFailure: (userId, method, ip, reason) => {
      logger.warn('2FA verification failed', {
        userId,
        method,
        event: '2fa_verification_failure',
        reason,
        ip,
        meta: { type: 'security' }
      });
    },

    backupCodeUsed: (userId, ip) => {
      logger.warn('Backup code used', {
        userId,
        event: 'backup_code_used',
        ip,
        meta: { type: 'security' }
      });
    },

    backupCodesRegenerated: (userId, ip) => {
      logger.info('Backup codes regenerated', {
        userId,
        event: 'backup_codes_regenerated',
        ip,
        meta: { type: 'security' }
      });
    }
  },

  // Security logging
  security: {
    rateLimitExceeded: (ip, endpoint, userAgent) => {
      logger.warn('Rate limit exceeded', {
        ip,
        endpoint,
        event: 'rate_limit_exceeded',
        userAgent,
        meta: { type: 'security' }
      });
    },

    bruteForceAttempt: (ip, endpoint, attempts, userAgent) => {
      logger.error('Potential brute force attack detected', {
        ip,
        endpoint,
        attempts,
        event: 'brute_force_attempt',
        userAgent,
        meta: { type: 'security', severity: 'high' }
      });
    },

    suspiciousActivity: (userId, activity, ip, details) => {
      logger.warn('Suspicious activity detected', {
        userId,
        activity,
        event: 'suspicious_activity',
        ip,
        details,
        meta: { type: 'security' }
      });
    },

    inputValidationError: (endpoint, field, value, ip) => {
      logger.warn('Input validation error', {
        endpoint,
        field,
        value: value ? '[REDACTED]' : null,
        event: 'validation_error',
        ip,
        meta: { type: 'validation' }
      });
    }
  },

  // Database logging
  database: {
    connectionError: (error) => {
      logger.error('Database connection error', {
        error: error.message,
        stack: error.stack,
        event: 'db_connection_error',
        meta: { type: 'database' }
      });
    },

    queryError: (query, params, error) => {
      logger.error('Database query error', {
        query,
        params: params ? '[REDACTED]' : null,
        error: error.message,
        event: 'db_query_error',
        meta: { type: 'database' }
      });
    },

    migrationError: (migration, error) => {
      logger.error('Database migration error', {
        migration,
        error: error.message,
        event: 'db_migration_error',
        meta: { type: 'database' }
      });
    }
  },

  // Application logging
  app: {
    startup: (port, environment) => {
      logger.info('Application started', {
        port,
        environment,
        event: 'app_startup',
        meta: { type: 'application' }
      });
    },

    shutdown: (signal) => {
      logger.info('Application shutting down', {
        signal,
        event: 'app_shutdown',
        meta: { type: 'application' }
      });
    },

    healthCheck: () => {
      logger.debug('Health check performed', {
        event: 'health_check',
        meta: { type: 'application' }
      });
    }
  },

  // Error logging with context
  error: (error, context = {}) => {
    logger.error('Application error', {
      error: error.message,
      stack: error.stack,
      ...context,
      event: 'application_error',
      meta: { type: 'error', severity: 'medium' }
    });
  },

  // Performance logging
  performance: {
    slowQuery: (query, duration, params) => {
      logger.warn('Slow database query detected', {
        query,
        duration: `${duration}ms`,
        params: params ? '[REDACTED]' : null,
        event: 'slow_query',
        meta: { type: 'performance' }
      });
    },

    slowRequest: (method, url, duration, statusCode) => {
      logger.warn('Slow request detected', {
        method,
        url,
        duration: `${duration}ms`,
        statusCode,
        event: 'slow_request',
        meta: { type: 'performance' }
      });
    }
  }
};

// Export both the winston logger and utility functions
module.exports = {
  logger,
  ...loggerUtils
};
