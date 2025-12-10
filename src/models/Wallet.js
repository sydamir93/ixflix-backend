const db = require('../config/database');

class Wallet {
  // Get or create both wallets (main only for IXFLIX)
  static async getOrCreateBothWallets(userId) {
    // For IXFLIX, we only use main wallet
    const existingWallet = await db('wallets')
      .where({ user_id: userId, wallet_type: 'main' })
      .first();

    if (existingWallet) {
      return { main: existingWallet };
    }

    // Create main wallet if it doesn't exist
    const [mainWallet] = await db('wallets')
      .insert({
        user_id: userId,
        wallet_type: 'main',
        balance: 0
      })
      .returning('*');

    return { main: mainWallet };
  }

  // Get both balances (main only for IXFLIX)
  static async getBothBalances(userId) {
    const wallets = await this.getOrCreateBothWallets(userId);
    return {
      main: parseFloat(wallets.main.balance || 0)
    };
  }

  // Update balance for specific wallet type
  static async updateBalance(userId, amount, operation, walletType = 'main', trx = null) {
    const query = trx || db;

    const wallet = await query('wallets')
      .where({ user_id: userId, wallet_type: walletType })
      .first();

    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId} and type ${walletType}`);
    }

    const currentBalance = parseFloat(wallet.balance);
    let newBalance;

    if (operation === 'add') {
      newBalance = currentBalance + parseFloat(amount);
    } else if (operation === 'subtract') {
      newBalance = currentBalance - parseFloat(amount);
    } else {
      throw new Error(`Invalid operation: ${operation}`);
    }

    // Ensure balance doesn't go negative
    if (newBalance < 0) {
      throw new Error(`Insufficient balance in ${walletType} wallet`);
    }

    // Update wallet balance
    await query('wallets')
      .where({ user_id: userId, wallet_type: walletType })
      .update({
        balance: newBalance,
        updated_at: query.fn.now()
      });

    return newBalance;
  }

  // Check if user has sufficient balance
  static async hasSufficientBalance(userId, amount, walletType = 'main') {
    const wallet = await db('wallets')
      .where({ user_id: userId, wallet_type: walletType })
      .first();

    if (!wallet) {
      return false;
    }

    return parseFloat(wallet.balance) >= parseFloat(amount);
  }

  // Transfer between users (only main to main for IXFLIX)
  static async transfer(fromUserId, toUserId, amount, description = null, fromWalletType = 'main', toWalletType = 'main') {
    return await db.transaction(async (trx) => {
      // Deduct from sender
      await this.updateBalance(fromUserId, amount, 'subtract', fromWalletType, trx);

      // Add to recipient
      await this.updateBalance(toUserId, amount, 'add', toWalletType, trx);

      // Create transaction records
      const timestamp = trx.fn.now();

      // Debit transaction for sender
      await trx('transactions').insert({
        user_id: fromUserId,
        wallet_type: fromWalletType,
        transaction_type: 'transfer',
        amount: -parseFloat(amount),
        currency: 'USD',
        status: 'completed',
        description: description || `Transfer to user ${toUserId}`,
        created_at: timestamp,
        updated_at: timestamp
      });

      // Credit transaction for recipient
      await trx('transactions').insert({
        user_id: toUserId,
        wallet_type: toWalletType,
        transaction_type: 'transfer',
        amount: parseFloat(amount),
        currency: 'USD',
        status: 'completed',
        description: description || `Transfer from user ${fromUserId}`,
        created_at: timestamp,
        updated_at: timestamp
      });

      return true;
    });
  }
}

module.exports = Wallet;
