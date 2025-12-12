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
 * - Higher rank overrides lower rank percentages
 * - Each upline sponsor gets the difference between their rank % and the previous rank %
 * - Origin user does NOT keep any portion - entire core reward is distributed upline
 * - Ensures 100% of Core Energy Reward is fully allocated among eligible ranks
 * - Only core_reward is used for overrides (not harvest).
 */
async function distributePowerPassUp({ originUserId, coreAmount, referenceId, trx = db }) {
  if (!coreAmount || coreAmount <= 0) return { distributed: 0, allocations: [] };

  // Get the origin user's name for the description
  const originUser = await trx('users').where({ id: originUserId }).select('name').first();
  const originUserName = originUser?.name || `User ${originUserId}`;

  const chain = await getSponsorChain(originUserId, 9);
  const allocations = [];

  // Build rank chain with percentages (filter out unranked users)
  const rankChain = [];
  for (const sponsorId of chain) {
    const sponsorPercent = await getUserRankPercent(sponsorId);
    if (sponsorPercent > 0) {
      rankChain.push({ sponsorId, sponsorPercent });
    }
  }

  // Sort by rank percentage ascending (lowest to highest)
  rankChain.sort((a, b) => a.sponsorPercent - b.sponsorPercent);

  let previousPercent = 0;
  let totalDistributedPercent = 0;

  for (const { sponsorId, sponsorPercent } of rankChain) {
    const overridePercent = sponsorPercent - previousPercent;
    if (overridePercent <= 0) continue;

    const rawReward = coreAmount * (overridePercent / 100);
    const { allowed } = await RewardCap.clampIncentive(sponsorId, rawReward, trx);

    if (allowed > 0) {
      // Make the payment
      await trx('wallets')
        .where({ user_id: sponsorId, wallet_type: 'main' })
        .increment('balance', allowed);

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

      allocations.push({ sponsorId, percent: overridePercent, amount: allowed });
      totalDistributedPercent += overridePercent;
    }

    // Always update previousPercent for the next calculation
    // This ensures the override chain continues even if someone is capped
    previousPercent = sponsorPercent;
  }

  // If total distributed is less than 100%, give the remaining to the highest rank sponsor
  if (totalDistributedPercent < 100 && rankChain.length > 0) {
    const highestRankSponsor = rankChain[rankChain.length - 1]; // last in sorted array (highest %)
    const remainingPercent = 100 - totalDistributedPercent;
    const rawReward = coreAmount * (remainingPercent / 100);
    const { allowed } = await RewardCap.clampIncentive(highestRankSponsor.sponsorId, rawReward, trx);

    if (allowed > 0) {
      // Credit wallet
      await trx('wallets')
        .where({ user_id: highestRankSponsor.sponsorId, wallet_type: 'main' })
        .increment('balance', allowed);

      // Record transaction
      await trx('transactions').insert({
        user_id: highestRankSponsor.sponsorId,
        wallet_type: 'main',
        transaction_type: 'power_passup',
        reference_type: 'stake_reward',
        reference_id: referenceId?.toString?.() || String(referenceId),
        amount: allowed,
        currency: 'USD',
        status: 'completed',
        description: `Power Pass-Up from ${originUserName} (${remainingPercent}% remaining)`,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });

      allocations.push({ sponsorId: highestRankSponsor.sponsorId, percent: remainingPercent, amount: allowed });
    }
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

