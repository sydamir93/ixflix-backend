const db = require('../config/database');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const NowPaymentService = require('../services/NowPaymentService');
const { logger } = require('../utils/logger');
const bcrypt = require('bcryptjs');

const DEFAULT_PAGE_SIZE = 25;

const parseMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return { ...metadata };
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
};

const mapDepositStatus = (paymentStatus) => {
  switch (paymentStatus) {
    case 'finished':
    case 'confirmed':
      return 'completed';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'partially_paid':
      return 'partially_paid';
    default:
      return 'pending';
  }
};

const mapPayoutStatus = (payoutStatus) => {
  switch (payoutStatus) {
    case 'finished':
    case 'confirmed':
      return 'completed';
    case 'failed':
    case 'expired':
    case 'rejected':
      return 'failed';
    default:
      return 'pending';
  }
};

// Admin: list all deposit transactions
const listDeposits = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const { status, user_id: userId, search } = req.query;

    const baseQuery = db('transactions as t')
      .join('users as u', 't.user_id', 'u.id')
      .where('t.transaction_type', 'deposit');

    if (status) {
      baseQuery.andWhere('t.status', status);
    }

    if (userId) {
      baseQuery.andWhere('t.user_id', userId);
    }

    if (search) {
      baseQuery.andWhere((qb) => {
        qb.where('u.phone_number', 'like', `%${search}%`)
          .orWhere('u.email', 'like', `%${search}%`)
          .orWhere('u.name', 'like', `%${search}%`);
      });
    }

    const [rows, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          't.*',
          'u.name as user_name',
          'u.email as user_email',
          'u.phone_number as user_phone'
        )
        .orderBy('t.created_at', 'desc')
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count')
    ]);

    const transactions = rows.map((row) => ({
      ...row,
      metadata: parseMetadata(row.metadata)
    }));

    return res.json({
      status: 'SUCCESS',
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total: parseInt(count, 10) || 0,
          total_pages: Math.ceil((parseInt(count, 10) || 0) / limit)
        }
      }
    });
  } catch (error) {
    logger.error('List deposits (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch deposits' });
  }
};

// Admin: list all withdrawal transactions
const listWithdrawals = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const { status, user_id: userId, search } = req.query;

    const baseQuery = db('transactions as t')
      .join('users as u', 't.user_id', 'u.id')
      .where('t.transaction_type', 'withdraw');

    if (status) {
      baseQuery.andWhere('t.status', status);
    }

    if (userId) {
      baseQuery.andWhere('t.user_id', userId);
    }

    if (search) {
      baseQuery.andWhere((qb) => {
        qb.where('u.phone_number', 'like', `%${search}%`)
          .orWhere('u.email', 'like', `%${search}%`)
          .orWhere('u.name', 'like', `%${search}%`);
      });
    }

    const [rows, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          't.*',
          'u.name as user_name',
          'u.email as user_email',
          'u.phone_number as user_phone'
        )
        .orderBy('t.created_at', 'desc')
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count')
    ]);

    const transactions = rows.map((row) => ({
      ...row,
      metadata: parseMetadata(row.metadata)
    }));

    return res.json({
      status: 'SUCCESS',
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total: parseInt(count, 10) || 0,
          total_pages: Math.ceil((parseInt(count, 10) || 0) / limit)
        }
      }
    });
  } catch (error) {
    logger.error('List withdrawals (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch withdrawals' });
  }
};

// Admin: list all users
const listUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const { role, search } = req.query;

    const baseQuery = db('users')
      .leftJoin('two_factor_auth as tfa', 'users.id', 'tfa.user_id');

    if (role) {
      baseQuery.andWhere('role', role);
    }

    if (search) {
      baseQuery.andWhere((qb) => {
        qb.where('phone_number', 'like', `%${search}%`)
          .orWhere('email', 'like', `%${search}%`)
          .orWhere('name', 'like', `%${search}%`);
      });
    }

    const [rows, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          'users.id',
          'users.name',
          'users.email',
          'users.phone_number',
          'users.role',
          'users.is_active',
          'users.is_verified',
          'users.created_at',
          'users.updated_at',
          'users.referral_code',
          db.raw('COALESCE(tfa.is_enabled, false) as has_2fa')
        )
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count')
    ]);

    return res.json({
      status: 'SUCCESS',
      data: {
        users: rows,
        pagination: {
          page,
          limit,
          total: parseInt(count, 10) || 0,
          total_pages: Math.ceil((parseInt(count, 10) || 0) / limit)
        }
      }
    });
  } catch (error) {
    logger.error('List users (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch users' });
  }
};

// Admin: update user basic information
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, phoneNumber, role, is_active: isActive, password } = req.body;
    const updates = {};

    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ status: 'ERROR', message: 'User not found' });
    }

    if (name) updates.name = name.trim();

    if (email) {
      const existing = await db('users').where({ email }).andWhereNot({ id: userId }).first();
      if (existing) {
        return res.status(409).json({ status: 'ERROR', message: 'Email already in use' });
      }
      updates.email = email.toLowerCase().trim();
    }

    if (phoneNumber) {
      const existingPhone = await db('users').where({ phone_number: phoneNumber }).andWhereNot({ id: userId }).first();
      if (existingPhone) {
        return res.status(409).json({ status: 'ERROR', message: 'Phone number already in use' });
      }
      updates.phone_number = phoneNumber;
    }

    if (role) {
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ status: 'ERROR', message: 'Invalid role' });
      }
      updates.role = role;
    }

    if (typeof isActive === 'boolean') {
      updates.is_active = isActive;
    }

    if (password) {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ status: 'ERROR', message: 'Password must be at least 8 characters' });
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ status: 'ERROR', message: 'No updates provided' });
    }

    await db('users').where({ id: userId }).update({ ...updates, updated_at: new Date() });
    const updatedUser = await db('users').where({ id: userId }).first();

    logger.info('Admin updated user', { adminId: req.user.id, userId, updates: Object.keys(updates) });

    return res.json({ status: 'SUCCESS', data: { user: updatedUser } });
  } catch (error) {
    logger.error('Update user (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to update user' });
  }
};

// Admin: remove/reset a user's 2FA
const removeUser2FA = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ status: 'ERROR', message: 'User not found' });
    }

    await db.transaction(async (trx) => {
      await trx('two_factor_auth')
        .where({ user_id: userId })
        .update({ is_enabled: false, enabled_at: null, secret: null, updated_at: trx.fn.now() });

      await trx('backup_codes').where({ user_id: userId }).delete();
    });

    logger.info('Admin removed user 2FA', { adminId: req.user.id, userId });

    return res.json({ status: 'SUCCESS', message: '2FA removed for user' });
  } catch (error) {
    logger.error('Remove user 2FA (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to remove 2FA' });
  }
};

// Admin: manual deposit to a user wallet
const manualDepositToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, description } = req.body;
    const depositAmount = parseFloat(amount);

    if (!depositAmount || Number.isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ status: 'ERROR', message: 'Valid amount is required' });
    }

    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ status: 'ERROR', message: 'User not found' });
    }

    // Ensure wallet exists
    await Wallet.getOrCreateBothWallets(userId);

    const referenceId = `ADMIN-${Date.now()}`;
    let createdTransaction = null;

    await db.transaction(async (trx) => {
      const insertResult = await trx('transactions').insert({
        user_id: userId,
        wallet_type: 'main',
        transaction_type: 'deposit',
        reference_type: 'manual_admin',
        reference_id: referenceId,
        amount: depositAmount,
        fee: 0,
        currency: 'USD',
        status: 'completed',
        description: description || `Manual deposit by admin ${req.user.id}`,
        metadata: JSON.stringify({
          adminId: req.user.id,
          description,
          source: 'admin_manual_deposit'
        }),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      }).returning('*');

      let transactionRow = Array.isArray(insertResult) ? insertResult[0] : insertResult;

      // MySQL returns insert id; fetch the row if needed
      if (!transactionRow || typeof transactionRow === 'number') {
        const insertedId = typeof transactionRow === 'number' ? transactionRow : insertResult;
        transactionRow = await trx('transactions').where({ id: insertedId }).first();
      }

      await Wallet.updateBalance(userId, depositAmount, 'add', 'main', trx);

      createdTransaction = transactionRow;
    });

    logger.info('Admin manual deposit completed', {
      adminId: req.user.id,
      userId,
      amount: depositAmount,
      referenceId
    });

    return res.json({
      status: 'SUCCESS',
      message: 'Manual deposit completed',
      data: {
        transaction: createdTransaction
      }
    });
  } catch (error) {
    logger.error('Manual deposit (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to process manual deposit' });
  }
};

// Admin: fetch a user's wallet balance
const getUserWalletBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = await Wallet.getOrCreateBothWallets(userId);
    const balances = await Wallet.getBothBalances(userId);

    return res.json({
      status: 'SUCCESS',
      data: {
        wallet: wallet.main,
        balance: balances.main,
        total_balance: balances.main
      }
    });
  } catch (error) {
    logger.error('Get user wallet (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch user wallet' });
  }
};

// Admin: check NowPayments API status
const getNowPaymentsStatus = async (_req, res) => {
  try {
    const status = await NowPaymentService.testApiConnection();
    return res.json({
      status: 'SUCCESS',
      data: {
        nowpayments: status
      }
    });
  } catch (error) {
    logger.error('NowPayments status check failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch NowPayments status' });
  }
};

// Admin: get NowPayments balance
const getNowPaymentsBalance = async (_req, res) => {
  try {
    const balance = await NowPaymentService.getBalance();
    return res.json({
      status: 'SUCCESS',
      data: {
        nowpayments: balance
      }
    });
  } catch (error) {
    logger.error('NowPayments balance check failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch balance' });
  }
};

// Admin: requery deposit status with NowPayments
const requeryDepositStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await db('transactions').where({ id: transactionId, transaction_type: 'deposit' }).first();

    if (!transaction) {
      return res.status(404).json({ status: 'ERROR', message: 'Deposit transaction not found' });
    }

    const metadata = parseMetadata(transaction.metadata);
    const paymentId = metadata.payment_id || metadata.paymentId || metadata.payment_id || metadata.payment?.payment_id;

    if (!paymentId) {
      return res.status(400).json({ status: 'ERROR', message: 'No payment_id found for this transaction' });
    }

    const paymentStatus = await NowPaymentService.getPaymentStatus(paymentId);
    const processed = await NowPaymentService.processDepositCallback(paymentStatus);

    const updatedMetadata = {
      ...metadata,
      last_requery_at: new Date().toISOString(),
      last_requery_status: processed.status,
      raw_status: paymentStatus
    };

    const desiredStatus = mapDepositStatus(paymentStatus.payment_status || paymentStatus.status || processed.status);

    // Only credit wallet if moving from non-completed to completed
    if ((desiredStatus === 'completed' || desiredStatus === 'partially_paid') && transaction.status !== 'completed') {
      const creditAmount = parseFloat(processed.price_amount || transaction.amount || 0);

      await db.transaction(async (trx) => {
        await Transaction.updateStatus(transaction.id, 'completed', updatedMetadata, trx);
        if (creditAmount > 0) {
          await Wallet.updateBalance(transaction.user_id, creditAmount, 'add', 'main', trx);
        }
      });
    } else {
      if (transaction.status === 'completed' && desiredStatus === 'completed') {
        await Transaction.update(transaction.id, { metadata: updatedMetadata });
      } else {
        await Transaction.updateStatus(transaction.id, desiredStatus, updatedMetadata);
      }
    }

    const refreshedTx = await db('transactions').where({ id: transactionId }).first();

    return res.json({
      status: 'SUCCESS',
      data: {
        transaction: refreshedTx,
        nowpayments: paymentStatus
      }
    });
  } catch (error) {
    logger.error('Requery deposit (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to requery deposit' });
  }
};

// Admin: requery withdrawal/payout status with NowPayments
const requeryWithdrawalStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await db('transactions').where({ id: transactionId, transaction_type: 'withdraw' }).first();

    if (!transaction) {
      return res.status(404).json({ status: 'ERROR', message: 'Withdrawal transaction not found' });
    }

    const metadata = parseMetadata(transaction.metadata);
    const payoutId = metadata.payout?.id || metadata.payout_id || metadata.payoutId || transaction.reference_id;

    if (!payoutId) {
      return res.status(400).json({ status: 'ERROR', message: 'No payout identifier found for this transaction' });
    }

    const payoutStatus = await NowPaymentService.getPayoutStatus(payoutId);
    const desiredStatus = mapPayoutStatus(payoutStatus.status || payoutStatus.payout_status);

    const updatedMetadata = {
      ...metadata,
      last_requery_at: new Date().toISOString(),
      last_requery_status: desiredStatus,
      raw_status: payoutStatus
    };

    if (desiredStatus === 'failed' && transaction.status !== 'failed') {
      const alreadyRefunded = updatedMetadata.refunded || updatedMetadata.refunded_at;
      if (!alreadyRefunded) {
        const totalDebit = Math.abs(parseFloat(transaction.amount || 0)) + Math.abs(parseFloat(transaction.fee || 0));

        await db.transaction(async (trx) => {
          updatedMetadata.refunded = true;
          updatedMetadata.refunded_at = new Date().toISOString();

          await Transaction.updateStatus(transaction.id, 'failed', updatedMetadata, trx);

          if (totalDebit > 0) {
            await Wallet.updateBalance(transaction.user_id, totalDebit, 'add', 'main', trx);
            await trx('transactions').insert({
              user_id: transaction.user_id,
              wallet_type: 'main',
              transaction_type: 'withdraw_refund',
              reference_type: 'withdraw_requery',
              reference_id: `REFUND-${transaction.id}-${Date.now()}`,
              amount: totalDebit,
              fee: 0,
              currency: 'USD',
              status: 'completed',
              description: `Refund for failed withdrawal ${transaction.id}`,
              metadata: JSON.stringify({
                original_transaction_id: transaction.id,
                payout_status: payoutStatus,
                admin_requery: true
              }),
              created_at: trx.fn.now(),
              updated_at: trx.fn.now()
            });
          }
        });
      }
    } else if (desiredStatus === 'completed' && transaction.status !== 'completed') {
      await Transaction.updateStatus(transaction.id, 'completed', updatedMetadata);
    } else {
      await Transaction.updateStatus(transaction.id, desiredStatus, updatedMetadata);
    }

    const refreshedTx = await db('transactions').where({ id: transactionId }).first();

    return res.json({
      status: 'SUCCESS',
      data: {
        transaction: refreshedTx,
        nowpayments: payoutStatus
      }
    });
  } catch (error) {
    logger.error('Requery withdrawal (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to requery withdrawal' });
  }
};

// Admin: list stakes with user info
const listStakes = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const { status, pack_type: packType, user_id: userId, search } = req.query;

    const baseQuery = db('stakes as s')
      .join('users as u', 's.user_id', 'u.id');

    if (status) {
      baseQuery.andWhere('s.status', status);
    }

    if (packType) {
      baseQuery.andWhere('s.pack_type', packType);
    }

    if (userId) {
      baseQuery.andWhere('s.user_id', userId);
    }

    if (search) {
      baseQuery.andWhere((qb) => {
        qb.where('u.phone_number', 'like', `%${search}%`)
          .orWhere('u.email', 'like', `%${search}%`)
          .orWhere('u.name', 'like', `%${search}%`);
      });
    }

    const [rows, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          's.*',
          'u.name as user_name',
          'u.email as user_email',
          'u.phone_number as user_phone'
        )
        .orderBy('s.created_at', 'desc')
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count')
    ]);

    return res.json({
      status: 'SUCCESS',
      data: {
        stakes: rows,
        pagination: {
          page,
          limit,
          total: parseInt(count, 10) || 0,
          total_pages: Math.ceil((parseInt(count, 10) || 0) / limit)
        }
      }
    });
  } catch (error) {
    logger.error('List stakes (admin) failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ status: 'ERROR', message: 'Failed to fetch stakes' });
  }
};

module.exports = {
  listDeposits,
  listWithdrawals,
  listStakes,
  listUsers,
  updateUser,
  removeUser2FA,
  manualDepositToUser,
  getUserWalletBalance,
  getNowPaymentsStatus,
  getNowPaymentsBalance,
  requeryDepositStatus,
  requeryWithdrawalStatus
};


