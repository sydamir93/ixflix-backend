const db = require('../config/database');

class Transaction {
  // Create a new transaction
  static async create(data) {
    const [transaction] = await db('transactions')
      .insert({
        user_id: data.user_id,
        wallet_type: data.wallet_type || 'main',
        transaction_type: data.transaction_type,
        reference_type: data.reference_type,
        reference_id: data.reference_id,
        amount: data.amount,
        fee: data.fee || 0,
        currency: data.currency || 'USD',
        status: data.status || 'pending',
        description: data.description,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      })
      .returning('*');

    return transaction;
  }

  // Find transaction by reference
  static async findByReference(referenceType, referenceId) {
    return await db('transactions')
      .where({
        reference_type: referenceType,
        reference_id: referenceId
      })
      .first();
  }

  // Find transactions by user ID with filters
  static async findByUserId(userId, filters = {}) {
    let query = db('transactions')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');

    // Apply filters
    if (filters.transaction_type) {
      query = query.where({ transaction_type: filters.transaction_type });
    }

    if (filters.status) {
      query = query.where({ status: filters.status });
    }

    if (filters.start_date) {
      query = query.where('created_at', '>=', filters.start_date);
    }

    if (filters.end_date) {
      query = query.where('created_at', '<=', filters.end_date);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    const transactions = await query;

    // Parse metadata for each transaction, tolerate non-string metadata
    return transactions.map(transaction => {
      let metadata = null;
      if (transaction.metadata) {
        if (typeof transaction.metadata === 'string') {
          try {
            metadata = JSON.parse(transaction.metadata);
          } catch (err) {
            metadata = null;
          }
        } else if (typeof transaction.metadata === 'object') {
          metadata = transaction.metadata;
        }
      }
      return { ...transaction, metadata };
    });
  }

  // Count transactions for user with filters
  static async count(userId, filters = {}) {
    let query = db('transactions')
      .where({ user_id: userId })
      .count('id as count');

    // Apply filters
    if (filters.transaction_type) {
      query = query.where({ transaction_type: filters.transaction_type });
    }

    if (filters.status) {
      query = query.where({ status: filters.status });
    }

    if (filters.start_date) {
      query = query.where('created_at', '>=', filters.start_date);
    }

    if (filters.end_date) {
      query = query.where('created_at', '<=', filters.end_date);
    }

    const result = await query.first();
    return parseInt(result.count);
  }

  // Get user transaction stats
  static async getUserStats(userId, dateRange = null) {
    let query = db('transactions')
      .where({ user_id: userId });

    if (dateRange) {
      if (dateRange.start) {
        query = query.where('created_at', '>=', dateRange.start);
      }
      if (dateRange.end) {
        query = query.where('created_at', '<=', dateRange.end);
      }
    }

    const stats = await query
      .select(
        'transaction_type',
        'status',
        db.raw('COUNT(*) as count'),
        db.raw('SUM(amount) as total_amount'),
        db.raw('SUM(fee) as total_fees')
      )
      .groupBy('transaction_type', 'status');

    const result = {
      totalTransactions: 0,
      deposits: { count: 0, amount: 0, fees: 0 },
      withdrawals: { count: 0, amount: 0, fees: 0 },
      transfers: { count: 0, amount: 0, fees: 0 },
      stakeRewards: { count: 0, amount: 0, fees: 0 },
      stakes: { count: 0, amount: 0, fees: 0 },
      completed: 0,
      pending: 0,
      failed: 0
    };

    stats.forEach(stat => {
      const count = parseInt(stat.count);
      const amount = parseFloat(stat.total_amount || 0);
      const fees = parseFloat(stat.total_fees || 0);

      result.totalTransactions += count;

      switch (stat.transaction_type) {
        case 'deposit':
          result.deposits.count += count;
          result.deposits.amount += amount;
          result.deposits.fees += fees;
          break;
        case 'withdraw':
          result.withdrawals.count += count;
          result.withdrawals.amount += Math.abs(amount); // withdrawals are stored as negative
          result.withdrawals.fees += fees;
          break;
        case 'transfer':
          result.transfers.count += count;
          result.transfers.amount += Math.abs(amount);
          result.transfers.fees += fees;
          break;
        case 'stake':
          result.stakes.count += count;
          result.stakes.amount += Math.abs(amount); // stakes are stored as negative (debit)
          result.stakes.fees += fees;
          break;
        case 'stake_reward':
          result.stakeRewards.count += count;
          result.stakeRewards.amount += amount; // rewards are positive (credit)
          result.stakeRewards.fees += fees;
          break;
      }

      switch (stat.status) {
        case 'completed':
          result.completed += count;
          break;
        case 'pending':
          result.pending += count;
          break;
        case 'failed':
          result.failed += count;
          break;
      }
    });

    return result;
  }

  // Update transaction
  static async update(id, updates) {
    const updateData = {
      ...updates,
      updated_at: db.fn.now()
    };

    if (updates.metadata) {
      updateData.metadata = JSON.stringify(updates.metadata);
    }

    const result = await db('transactions')
      .where({ id })
      .update(updateData)
      .returning('*');

    let transaction = null;

    if (Array.isArray(result)) {
      transaction = result[0] || null;
    } else if (result && typeof result === 'object') {
      transaction = result;
    }

    if (!transaction) {
      transaction = await db('transactions').where({ id }).first();
    }

    if (transaction && typeof transaction.metadata === 'string') {
      transaction.metadata = JSON.parse(transaction.metadata);
    }

    return transaction;
  }

  // Update transaction status
  static async updateStatus(id, status, metadata = null, trx = null) {
    const query = trx || db;

    const updateData = {
      status,
      updated_at: query.fn.now()
    };

    if (metadata) {
      updateData.metadata = JSON.stringify(metadata);
    }

    const result = await query('transactions')
      .where({ id })
      .update(updateData)
      .returning('*');

    let updatedTransaction = null;

    if (Array.isArray(result)) {
      updatedTransaction = result[0] || null;
    } else if (result && typeof result === 'object') {
      updatedTransaction = result;
    }

    if (!updatedTransaction) {
      updatedTransaction = await query('transactions')
        .where({ id })
        .first();
    }

    if (updatedTransaction && typeof updatedTransaction.metadata === 'string') {
      updatedTransaction.metadata = JSON.parse(updatedTransaction.metadata);
    }

    return updatedTransaction;
  }
}

module.exports = Transaction;
