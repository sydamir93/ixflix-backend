const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorizeAdmin } = require('../middleware/auth');

// All admin routes require authentication + admin role
router.use(authenticate, authorizeAdmin);

// Users
router.get('/users', adminController.listUsers);
router.get('/users/:userId/wallet', adminController.getUserWalletBalance);
router.put('/users/:userId', adminController.updateUser);
router.post('/users/:userId/remove-2fa', adminController.removeUser2FA);
router.post('/users/:userId/manual-deposit', adminController.manualDepositToUser);

// Stakes
router.get('/stakes', adminController.listStakes);
router.post('/stakes/free', adminController.createFreeStake);

// Deposits
router.get('/deposits', adminController.listDeposits);
router.post('/deposits/:transactionId/requery', adminController.requeryDepositStatus);

// Manual Deposits
router.get('/manual-deposits', adminController.listManualDeposits);
router.post('/manual-deposits/:transaction_id/process', adminController.processManualDepositAdmin);

// Alternative route using wallet controller (for backward compatibility)
const walletController = require('../controllers/walletController');
router.get('/wallet/manual-deposits', walletController.getPendingManualDeposits);
router.post('/wallet/manual-deposits/:transaction_id/process', walletController.processManualDeposit);

// Withdrawals
router.get('/withdrawals', adminController.listWithdrawals);
router.post('/withdrawals/:transactionId/requery', adminController.requeryWithdrawalStatus);

// NowPayments diagnostics
router.get('/nowpayments/status', adminController.getNowPaymentsStatus);
router.get('/nowpayments/balance', adminController.getNowPaymentsBalance);

// Genealogy
router.get('/pairing-genealogy', adminController.getPairingGenealogy);

module.exports = router;


