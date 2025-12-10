const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorizeAdmin } = require('../middleware/auth');

// All admin routes require authentication + admin role
router.use(authenticate, authorizeAdmin);

// Users
router.get('/users', adminController.listUsers);
router.put('/users/:userId', adminController.updateUser);
router.post('/users/:userId/remove-2fa', adminController.removeUser2FA);
router.post('/users/:userId/manual-deposit', adminController.manualDepositToUser);

// Stakes
router.get('/stakes', adminController.listStakes);

// Deposits
router.get('/deposits', adminController.listDeposits);
router.post('/deposits/:transactionId/requery', adminController.requeryDepositStatus);

// Withdrawals
router.get('/withdrawals', adminController.listWithdrawals);
router.post('/withdrawals/:transactionId/requery', adminController.requeryWithdrawalStatus);

// NowPayments diagnostics
router.get('/nowpayments/status', adminController.getNowPaymentsStatus);
router.get('/nowpayments/balance', adminController.getNowPaymentsBalance);

module.exports = router;


