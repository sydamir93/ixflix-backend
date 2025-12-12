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

// Get user rank percent based on live eligibility
async function getUserRankPercent(userId) {
  const Rank = require('./Rank');
  const evalResult = await Rank.evaluateUserRank(userId);

  if (evalResult?.targetPercent) return Number(evalResult.targetPercent);

  if (evalResult?.targetRank && RANKS[evalResult.targetRank] !== undefined) {
    return RANKS[evalResult.targetRank];
  }

  return 0;
}

// Fetch upline chain (max 9 levels)
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
 * PDF-Compliant Power Pass-Up
 * - Origin user keeps their core reward (rank-independent)
 * - Each upline earns override ONLY if rank% > previous rank in chain
 * - Override = difference between upline rank and previous rank
 * - All overrides are computed from the **original core reward** amount
 * - Skipped lower/equal rank uplines do not change baseline
 * - Any unearned portion can be retained by the company
 */
async function distributePowerPassUp({ originUserId, coreAmount, referenceId, trx = db }) {
  if (!coreAmount || coreAmount <= 0) return { distributed: 0, allocations: [] };

  const originUser = await trx('users').where({ id: originUserId }).select('name').first();
  const originUserName = originUser?.name || `User ${originUserId}`;

  const chain = await getSponsorChain(originUserId, 9);
  const allocations = [];

  let previousRankPercent = 0; // PDF-compliant: always start baseline at 0

  for (const sponsorId of chain) {
    const sponsorRankPercent = await getUserRankPercent(sponsorId);

    // Skip unranked or lower/equal rank sponsors
    if (sponsorRankPercent <= previousRankPercent) continue;

    const overridePercent = sponsorRankPercent - previousRankPercent;
    const earnedAmount = (overridePercent / 100) * coreAmount;

    if (earnedAmount <= 0) {
      previousRankPercent = sponsorRankPercent;
      continue;
    }

    // Apply RewardCap
    const { allowed } = await RewardCap.clampIncentive(sponsorId, earnedAmount, trx);

    if (allowed > 0) {
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
        description: `Power Pass-Up from ${originUserName} (${overridePercent}% override)`,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });

      allocations.push({
        sponsorId,
        percent: overridePercent,
        amount: allowed
      });
    }

    // Update baseline for next sponsor
    previousRankPercent = sponsorRankPercent;
  }

  const distributed = allocations.reduce((s, a) => s + a.amount, 0);
  return { distributed, allocations };
}

module.exports = {
  distributePowerPassUp,
  getUserRankPercent,
  getSponsorChain,
  RANKS
};
