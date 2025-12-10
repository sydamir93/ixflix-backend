const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const stakeController = require('../controllers/stakeController');
const synergyController = require('../controllers/synergyController');
const jobController = require('../controllers/jobController');
const { authenticate } = require('../middleware/auth');

// All wallet routes require authentication
router.use(authenticate);

// Get wallet balance
router.get('/balance', walletController.getBalance);

// Get transaction history
router.get('/transactions', walletController.getTransactionHistory);

// Get transaction statistics
router.get('/stats', walletController.getTransactionStats);

// Wallet config (fees etc.)
router.get('/config', walletController.getWalletConfig);

// Incentive summary (caps + totals)
router.get('/incentives/summary', walletController.getIncentiveSummary);

// Initiate deposit
router.post('/deposit', walletController.initiateDeposit);

// Handle deposit callback from NowPayment (no auth required for callbacks)
router.post('/deposit/callback', walletController.handleDepositCallback);

// Initiate withdrawal via NowPayments payout
router.post('/withdraw', walletController.initiateWithdraw);

// Transfer to another user
router.post('/transfer', walletController.transferToUser);

// Staking routes
router.get('/stakes/packs', stakeController.getAvailablePacks);
router.get('/stakes', stakeController.getUserStakes);
router.get('/stakes/summary', stakeController.getUserStakeSummary);
router.get('/stakes/pending-summary', stakeController.getPendingRewardsSummary);
router.get('/stakes/eligibility', stakeController.getStakeEligibility);
router.post('/stakes', stakeController.createStake);
router.get('/stakes/:stake_id/rewards', stakeController.getStakeRewards);
router.post('/stakes/:stake_id/credit-rewards', stakeController.creditStakeRewards);

// Admin/system routes (should be protected in production)
router.post('/stakes/calculate-daily-rewards', stakeController.calculateDailyRewards);

// Synergy Flow routes
router.get('/network/synergy', synergyController.getSynergySummary);
router.get('/network/synergy/history', synergyController.getSynergyHistory);
router.post('/network/synergy/run', synergyController.runSynergyPayouts);
router.get('/network/synergy/history/all', synergyController.getSynergyHistoryAll);

// Job status (admin)
router.get('/jobs', jobController.listJobStatuses);
router.get('/jobs/:job_name', jobController.getJobStatus);

module.exports = router;
