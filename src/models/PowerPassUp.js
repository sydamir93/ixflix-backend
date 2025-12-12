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

// Calculate potential Power Pass-Up bonuses from pending downline rewards
async function calculatePotentialPowerPassUp(userId, trx = db) {
  // Get all users in this user's downline (recursive)
  const downlineUserIds = await getDownlineUserIds(userId);

  if (downlineUserIds.length === 0) {
    return {
      potentialBonuses: 0,
      pendingRewards: [],
      downlinePendingBreakdown: []
    };
  }

  // Find all pending stake rewards for downline users with user details
  const pendingRewards = await trx('stake_rewards')
    .whereIn('stake_id', function() {
      this.select('id').from('stakes').whereIn('user_id', downlineUserIds).where('stakes.status', 'active');
    })
    .where('stake_rewards.status', 'pending')
    .select(
      'stake_rewards.*',
      'stakes.user_id as staker_id',
      'users.name as staker_name'
    )
    .join('stakes', 'stake_rewards.stake_id', '=', 'stakes.id')
    .join('users', 'stakes.user_id', '=', 'users.id');

  let totalPotentialBonus = 0;
  const bonusDetails = [];
  const downlinePendingBreakdown = [];

  // Group pending rewards by staker
  const stakerRewards = {};
  for (const reward of pendingRewards) {
    if (!stakerRewards[reward.staker_id]) {
      stakerRewards[reward.staker_id] = {
        stakerId: reward.staker_id,
        stakerName: reward.staker_name,
        rewards: [],
        totalCore: 0,
        totalHarvest: 0,
        totalRewards: 0,
        potentialBonus: 0
      };
    }
    stakerRewards[reward.staker_id].rewards.push(reward);
    stakerRewards[reward.staker_id].totalCore += parseFloat(reward.core_reward);
    stakerRewards[reward.staker_id].totalHarvest += parseFloat(reward.harvest_reward || 0);
    stakerRewards[reward.staker_id].totalRewards += parseFloat(reward.total_reward);
  }

  // Calculate potential Power Pass-Up for each staker's rewards
  for (const stakerId of Object.keys(stakerRewards)) {
    const stakerData = stakerRewards[stakerId];
    let stakerPotentialBonus = 0;

    // Calculate bonus for each reward this staker has
    for (const reward of stakerData.rewards) {
      // Simulate Power Pass-Up distribution for this reward
      const simulationResult = await simulatePowerPassUp({
        originUserId: parseInt(stakerId),
        coreAmount: parseFloat(reward.core_reward),
        referenceId: `potential-${reward.id}`,
        trx
      });

      // Find the bonus amount for the current user
      const userBonus = simulationResult.allocations.find(a => a.sponsorId === userId);
      if (userBonus) {
        stakerPotentialBonus += userBonus.amount;
        bonusDetails.push({
          rewardId: reward.id,
          stakerId: parseInt(stakerId),
          coreReward: parseFloat(reward.core_reward),
          bonusAmount: userBonus.amount,
          bonusPercent: userBonus.percent,
          rewardDate: reward.reward_date
        });
      }
    }

    // Add to breakdown if they have potential bonuses
    if (stakerPotentialBonus > 0) {
      downlinePendingBreakdown.push({
        ...stakerData,
        potentialBonus: stakerPotentialBonus,
        rewardCount: stakerData.rewards.length
      });
    }

    totalPotentialBonus += stakerPotentialBonus;
  }

  return {
    potentialBonuses: totalPotentialBonus,
    pendingRewards: bonusDetails.length,
    bonusDetails,
    downlinePendingBreakdown
  };
}

// Calculate potential Power Pass-Up bonuses user will RECEIVE when claiming their own pending rewards
async function calculatePotentialReceivedPowerPassUp(userId, trx = db) {
  // Find user's own pending stake rewards
  const userPendingRewards = await trx('stake_rewards')
    .whereIn('stake_id', function() {
      this.select('id').from('stakes').where('user_id', userId).where('stakes.status', 'active');
    })
    .where('stake_rewards.status', 'pending')
    .select('stake_rewards.*')
    .join('stakes', 'stake_rewards.stake_id', '=', 'stakes.id');

  let totalPotentialReceived = 0;
  const receivedDetails = [];

  // Calculate potential Power Pass-Up bonuses user would receive for each of their pending rewards
  for (const reward of userPendingRewards) {
    // Simulate Power Pass-Up distribution for this reward (as if it were being claimed)
    const simulationResult = await simulatePowerPassUp({
      originUserId: userId,
      coreAmount: parseFloat(reward.core_reward),
      referenceId: `potential-receive-${reward.id}`,
      trx
    });

    // Sum all bonuses the user would receive (from all their upline sponsors)
    const userReceivedBonuses = simulationResult.allocations.filter(a => a.sponsorId !== userId); // Exclude self if any
    const totalForThisReward = userReceivedBonuses.reduce((sum, a) => sum + a.amount, 0);

    if (totalForThisReward > 0) {
      totalPotentialReceived += totalForThisReward;
      receivedDetails.push({
        rewardId: reward.id,
        coreReward: parseFloat(reward.core_reward),
        totalBonuses: totalForThisReward,
        bonusBreakdown: userReceivedBonuses,
        rewardDate: reward.reward_date
      });
    }
  }

  return {
    potentialReceivedBonuses: totalPotentialReceived,
    pendingRewardsCount: userPendingRewards.length,
    receivedDetails
  };
}

// Helper function to get all downline user IDs recursively
async function getDownlineUserIds(userId, trx = db) {
  const downlineIds = new Set();
  const queue = [userId];

  while (queue.length > 0) {
    const currentUserId = queue.shift();

    // Get direct children
    const children = await trx('genealogy')
      .where('sponsor_id', currentUserId)
      .select('user_id');

    for (const child of children) {
      if (!downlineIds.has(child.user_id)) {
        downlineIds.add(child.user_id);
        queue.push(child.user_id);
      }
    }
  }

  // Remove the original user from downline
  downlineIds.delete(userId);

  return Array.from(downlineIds);
}

// Simulate Power Pass-Up distribution without actually crediting (for potential calculations)
async function simulatePowerPassUp({ originUserId, coreAmount, referenceId, trx = db }) {
  if (!coreAmount || coreAmount <= 0) return { distributed: 0, allocations: [] };

  const chain = await getSponsorChain(originUserId, 9);
  const allocations = [];

  let previousRankPercent = 0; // PDF-compliant: always start at 0

  for (const sponsorId of chain) {
    const sponsorRankPercent = await getUserRankPercent(sponsorId);

    // Skip unranked or lower/equal rank sponsors
    if (sponsorRankPercent <= previousRankPercent) continue;

    const overridePercent = sponsorRankPercent - previousRankPercent;
    const earnedAmount = (overridePercent / 100) * coreAmount;

    // For simulation, assume no cap limits
    const allowed = earnedAmount;

    if (allowed > 0) {
      allocations.push({
        sponsorId,
        percent: overridePercent,
        amount: allowed
      });
    }

    previousRankPercent = sponsorRankPercent;
  }

  const distributed = allocations.reduce((s, a) => s + a.amount, 0);
  return { distributed, allocations };
}

module.exports = {
  distributePowerPassUp,
  getUserRankPercent,
  getSponsorChain,
  calculatePotentialPowerPassUp,
  calculatePotentialReceivedPowerPassUp,
  RANKS
};
