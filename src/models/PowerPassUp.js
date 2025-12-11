const RewardCap = require('./RewardCap');
const db = require('../config/database');

// Rank ladder (override percent on Core Energy Reward)
const RANKS = {
  spark: 5,
  pulse: 10,
  charge: 15,
  surge: 25,
  flux: 40,
  volt: 55,
  current: 70,
  magnet: 85,
  quantum: 100
};

// Get user rank percent; evaluate live eligibility against ladder requirements
async function getUserRankPercent(userId) {
  // Lazy-load to avoid circular import when Stake -> PowerPassUp -> Rank -> Stake
  const Rank = require('./Rank');
  const evalResult = await Rank.evaluateUserRank(userId);
  if (evalResult?.targetPercent) return Number(evalResult.targetPercent);
  if (evalResult?.targetRank && RANKS[evalResult.targetRank] !== undefined) {
    return RANKS[evalResult.targetRank];
  }
  return 0;
}

// Fetch sponsor upline chain (distinct, avoid loops)
async function getSponsorChain(userId, maxLevels = 9) {
  const chain = [];
  const visited = new Set();
  let current = userId;

  for (let i = 0; i < maxLevels; i++) {
    const row = await db('genealogy').where({ user_id: current }).first();
    if (!row || !row.sponsor_id || visited.has(row.sponsor_id)) break;
    chain.push(row.sponsor_id);
    visited.add(row.sponsor_id);
    current = row.sponsor_id;
  }
  return chain;
}

/**
 * Distribute Power Pass-Up on a credited Core Energy Reward.
 * - Uses rank overrides: each higher rank gets (own% - highestAllocated%).
 * - Stops at 100% or when chain ends.
 * - Only core_reward is used for overrides (not harvest).
 */
async function distributePowerPassUp({ originUserId, coreAmount, referenceId, trx = db }) {
  if (!coreAmount || coreAmount <= 0) return { distributed: 0, allocations: [] };

  const chain = await getSponsorChain(originUserId, 9);
  const allocations = [];

  let highestAllocated = await getUserRankPercent(originUserId); // origin keeps their portion separately
  let remaining = 100 - highestAllocated;

  for (const sponsorId of chain) {
    if (remaining <= 0) break;
    const sponsorPercent = await getUserRankPercent(sponsorId);
    const diff = sponsorPercent - highestAllocated;
    if (diff <= 0) continue;

    const rawReward = coreAmount * (diff / 100);
    const { allowed } = await RewardCap.clampIncentive(sponsorId, rawReward, trx);
    if (allowed <= 0) {
      highestAllocated = sponsorPercent; // even if no pay, the percent is considered allocated
      remaining = 100 - highestAllocated;
      continue;
    }

    // Credit wallet
    await trx('wallets')
      .where({ user_id: sponsorId, wallet_type: 'main' })
      .increment('balance', allowed);

    // Record transaction
    await trx('transactions').insert({
      user_id: sponsorId,
      wallet_type: 'main',
      transaction_type: 'power_passup',
      reference_type: 'stake_reward',
      reference_id: referenceId?.toString?.() || String(referenceId),
      amount: allowed,
      currency: 'USD',
      status: 'completed',
      description: `Power Pass-Up from stake reward ${referenceId} (${diff}% override)`,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });

    allocations.push({ sponsorId, percent: diff, amount: allowed });
    highestAllocated = sponsorPercent;
    remaining = 100 - highestAllocated;
  }

  const distributed = allocations.reduce((s, a) => s + a.amount, 0);
  return { distributed, allocations };
}

module.exports = {
  distributePowerPassUp,
  getUserRankPercent,
  RANKS
};

