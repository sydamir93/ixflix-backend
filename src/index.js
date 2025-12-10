require('dotenv').config();
// Default all backend date handling to Dubai time (UTC+4)
process.env.TZ = process.env.TZ || 'Asia/Dubai';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { logger, requestLogger, app: appLogger } = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Compression
app.use(compression());

// Request logging
app.use(requestLogger);

// HTTP logging (keep morgan for simple HTTP logs)
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiterAuth = rateLimit({
  windowMs: (parseInt(process.env.RATE_LIMIT_WINDOW) || 15) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// More generous limiter for authenticated wallet/stake routes; keyed by user when available
const limiterWallet = rateLimit({
  windowMs: (parseInt(process.env.RATE_LIMIT_WALLET_WINDOW) || 15) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_WALLET_MAX_REQUESTS) || 1000,
  message: 'Too many requests. Please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip
});

// Health check
app.get('/health', (req, res) => {
  appLogger.healthCheck();
  res.json({
    success: true,
    message: 'IXFLIX Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes with scoped rate limits
app.use('/api/auth', limiterAuth, authRoutes);
app.use('/api/wallet', limiterWallet, walletRoutes);
app.use('/api/admin', limiterWallet, adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled application error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    meta: { type: 'error', severity: 'high' }
  });

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  appLogger.startup(PORT, process.env.NODE_ENV || 'development');

  console.log('');
  console.log('🚀 IXFLIX Backend Server Started');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server running on: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:3001'}`);
  console.log(`💾 Database: ${process.env.DB_NAME || 'ixflix_db'}`);
  console.log(`📊 Log Level: ${process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📖 Available endpoints:');
  console.log('   GET  /health');
  console.log('   POST /api/auth/register');
  console.log('   POST /api/auth/login');
  console.log('   POST /api/auth/verify-totp (5 attempts/15min)');
  console.log('   POST /api/auth/verify-backup-code (5 attempts/15min)');
  console.log('   POST /api/auth/totp/setup');
  console.log('   POST /api/auth/totp/enable (10 attempts/5min)');
  console.log('   POST /api/auth/totp/disable (10 attempts/5min)');
  console.log('   POST /api/auth/totp/regenerate-backup-codes (10 attempts/5min)');
  console.log('   GET  /api/auth/me');
  console.log('   POST /api/auth/logout');
  console.log('   GET  /api/wallet/balance');
  console.log('   GET  /api/wallet/transactions');
  console.log('   GET  /api/wallet/stats');
  console.log('   POST /api/wallet/deposit');
  console.log('   POST /api/wallet/deposit/callback');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;

