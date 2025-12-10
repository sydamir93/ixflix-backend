const db = require('../config/database');

const INCENTIVE_TYPES = ['catalyst_bonus', 'synergy_flow', 'power_passup'];

async function getCapInfo(userId, trx = null) {
  const query = trx || db;
  // Lazy load to avoid circular require issues
  const Stake = require('./Stake');
  const { highestPack, totalAmount } = await Stake.getUserActivePackInfo(userId);
  if (!highestPack || totalAmount <= 0) {
    return { capAmount: 0, maxPercent: 0, available: 0, used: 0 };
  }

  const maxPercent = Stake.getPackMaxLimit(highestPack) || 0;
  const capAmount = totalAmount * (maxPercent / 100);

  const usedRow = await query('transactions')
    .where({ user_id: userId, status: 'completed' })
    .whereIn('transaction_type', INCENTIVE_TYPES)
    .sum({ total: 'amount' })
    .first();

  const used = parseFloat(usedRow?.total || 0);
  const available = Math.max(0, capAmount - used);

  return { capAmount, maxPercent, available, used };
}

async function clampIncentive(userId, amount, trx = null) {
  const info = await getCapInfo(userId, trx);
  if (info.available <= 0) return { allowed: 0, info };
  return { allowed: Math.max(0, Math.min(amount, info.available)), info };
}

module.exports = {
  getCapInfo,
  clampIncentive,
  INCENTIVE_TYPES
};

