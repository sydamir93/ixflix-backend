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

function unwrapRawRows(rawResult) {
  // MySQL2 via Knex returns [rows, fields]
  if (Array.isArray(rawResult)) return rawResult[0] || [];
  // Postgres-style
  if (rawResult && Array.isArray(rawResult.rows)) return rawResult.rows;
  return rawResult || [];
}

// Get user rank percent (fast path from stored user_ranks)
async function getUserRankPercent(userId, trx = db) {
  const row = await trx('user_ranks')
    .where({ user_id: userId })
    .select('override_percent')
    .first();

  const pct = Number(row?.override_percent || 0);
  return isFinite(pct) ? pct : 0;
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

async function buildSponsorPointerMap(seedUserIds, maxLevels = 9, trx = db) {
  const sponsorByUserId = new Map(); // user_id -> sponsor_id|null
  const seen = new Set();
  let frontier = new Set((seedUserIds || []).map((id) => Number(id)).filter(Boolean));

  for (let level = 0; level < maxLevels && frontier.size > 0; level++) {
    const ids = Array.from(frontier).filter((id) => !seen.has(id));
    frontier = new Set();
    if (ids.length === 0) break;

    ids.forEach((id) => seen.add(id));

    const rows = await trx('genealogy')
      .whereIn('user_id', ids)
      .select('user_id', 'sponsor_id');

    for (const r of rows) {
      const uid = Number(r.user_id);
      const sid = r.sponsor_id ? Number(r.sponsor_id) : null;
      sponsorByUserId.set(uid, sid);
      if (sid && !seen.has(sid)) frontier.add(sid);
    }
  }

  return sponsorByUserId;
}

function getSponsorChainFromMap(originUserId, sponsorByUserId, maxLevels = 9) {
  const chain = [];
  const visited = new Set();
  let current = Number(originUserId);
  for (let i = 0; i < maxLevels; i++) {
    const sponsorId = sponsorByUserId.get(current);
    if (!sponsorId || visited.has(sponsorId)) break;
    chain.push(sponsorId);
    visited.add(sponsorId);
    current = sponsorId;
  }
  return chain;
}

async function buildRankPercentMap(userIds, trx = db) {
  const ids = Array.from(new Set((userIds || []).map((id) => Number(id)).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const rows = await trx('user_ranks')
    .whereIn('user_id', ids)
    .select('user_id', 'override_percent');

  const map = new Map();
  for (const r of rows) {
    const pct = Number(r.override_percent || 0);
    map.set(Number(r.user_id), isFinite(pct) ? pct : 0);
  }
  return map;
}

function computeOverridePercentForTarget(chain, targetUserId, rankPercentByUserId) {
  const target = Number(targetUserId);
  let previousRankPercent = 0;

  for (const sponsorId of chain) {
    const sponsorRankPercent = Number(rankPercentByUserId.get(sponsorId) || 0);
    if (sponsorRankPercent <= previousRankPercent) continue;

    const overridePercent = sponsorRankPercent - previousRankPercent;
    if (sponsorId === target) {
      return { percent: overridePercent, sponsorRankPercent, previousRankPercent };
    }
    previousRankPercent = sponsorRankPercent;
  }

  return { percent: 0, sponsorRankPercent: 0, previousRankPercent: 0 };
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
    const sponsorRankPercent = await getUserRankPercent(sponsorId, trx);

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
  // Pull pending rewards for full downline in one shot (recursive CTE)
  const raw = await trx.raw(
    `
      WITH RECURSIVE downline AS (
        SELECT user_id
        FROM genealogy
        WHERE sponsor_id = ?

        UNION ALL

        SELECT g.user_id
        FROM genealogy g
        INNER JOIN downline d ON g.sponsor_id = d.user_id
      )
      SELECT
        sr.id,
        sr.reward_date,
        sr.core_reward,
        sr.harvest_reward,
        sr.total_reward,
        s.user_id AS staker_id,
        u.name AS staker_name
      FROM downline d
      INNER JOIN stakes s
        ON s.user_id = d.user_id
       AND s.status = 'active'
      INNER JOIN stake_rewards sr
        ON sr.stake_id = s.id
       AND sr.status = 'pending'
      INNER JOIN users u
        ON u.id = s.user_id
    `,
    [userId]
  );

  const pendingRewards = unwrapRawRows(raw);

  if (!pendingRewards || pendingRewards.length === 0) {
    return {
      potentialBonuses: 0,
      pendingRewards: 0,
      bonusDetails: [],
      downlinePendingBreakdown: [],
    };
  }

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

  const stakerIds = Object.keys(stakerRewards).map((id) => Number(id));

  // Build sponsor pointers and rank map in batches (no per-reward DB calls)
  const sponsorByUserId = await buildSponsorPointerMap(stakerIds, 9, trx);
  const sponsorUniverse = new Set();
  for (const v of sponsorByUserId.values()) {
    if (v) sponsorUniverse.add(v);
  }
  // Include the stakers themselves (some may not have rows in user_ranks yet)
  stakerIds.forEach((id) => sponsorUniverse.add(id));
  sponsorUniverse.add(Number(userId));

  const rankPercentByUserId = await buildRankPercentMap(Array.from(sponsorUniverse), trx);

  // Calculate potential Power Pass-Up for each staker's rewards (percent is constant per staker)
  for (const stakerId of stakerIds) {
    const stakerData = stakerRewards[stakerId];
    const chain = getSponsorChainFromMap(stakerId, sponsorByUserId, 9);
    const { percent: userOverridePercent } = computeOverridePercentForTarget(
      chain,
      userId,
      rankPercentByUserId
    );

    if (userOverridePercent <= 0) continue;

    let stakerPotentialBonus = 0;
    for (const reward of stakerData.rewards) {
      const coreReward = parseFloat(reward.core_reward);
      const bonusAmount = (userOverridePercent / 100) * coreReward;
      if (bonusAmount <= 0) continue;

      stakerPotentialBonus += bonusAmount;
      bonusDetails.push({
        rewardId: reward.id,
        stakerId: Number(stakerId),
        coreReward,
        bonusAmount,
        bonusPercent: userOverridePercent,
        rewardDate: reward.reward_date
      });
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
  // Find user's own pending stake rewards.
  // Use a single indexed join (avoids WHERE IN subquery plans) and only select needed columns
  // to reduce DB and JSON serialization overhead.
  const userPendingRewards = await trx('stake_rewards as sr')
    .join('stakes as s', 'sr.stake_id', 's.id')
    .where('s.user_id', userId)
    .where('s.status', 'active')
    .where('sr.status', 'pending')
    .select('sr.id', 'sr.core_reward', 'sr.reward_date');

  if (!userPendingRewards || userPendingRewards.length === 0) {
    return {
      potentialReceivedBonuses: 0,
      pendingRewardsCount: 0,
      receivedDetails: [],
    };
  }

  // Build upline info once for the user
  const sponsorByUserId = await buildSponsorPointerMap([userId], 9, trx);
  const chain = getSponsorChainFromMap(userId, sponsorByUserId, 9);
  const rankPercentByUserId = await buildRankPercentMap(chain, trx);

  // Precompute the upline allocation "shape" once. For each reward, amounts scale linearly by core_reward.
  // The total distributed percent equals the highest (strictly increasing) rank percent encountered in the chain.
  const allocationPercents = [];
  let totalOverridePercent = 0;
  for (const sponsorId of chain) {
    const sponsorRankPercent = Number(rankPercentByUserId.get(sponsorId) || 0);
    if (sponsorRankPercent <= totalOverridePercent) continue;
    const overridePercent = sponsorRankPercent - totalOverridePercent;
    allocationPercents.push({ sponsorId, percent: overridePercent });
    totalOverridePercent = sponsorRankPercent;
  }

  // If nobody in the upline has a higher rank percent than 0, then no pass-up would be distributed.
  if (totalOverridePercent <= 0) {
    return {
      potentialReceivedBonuses: 0,
      pendingRewardsCount: userPendingRewards.length,
      receivedDetails: [],
    };
  }

  let totalPotentialReceived = 0;
  const receivedDetails = [];

  // Calculate potential Power Pass-Up bonuses user would receive for each of their pending rewards
  for (const reward of userPendingRewards) {
    const coreAmount = parseFloat(reward.core_reward);
    if (!coreAmount || coreAmount <= 0) continue;

    // Total distributed for a reward is linear in coreAmount.
    const totalForThisReward = (totalOverridePercent / 100) * coreAmount;

    if (totalForThisReward > 0) {
      totalPotentialReceived += totalForThisReward;
      receivedDetails.push({
        rewardId: reward.id,
        coreReward: coreAmount,
        totalBonuses: totalForThisReward,
        bonusBreakdown: allocationPercents.map((a) => ({
          sponsorId: a.sponsorId,
          percent: a.percent,
          amount: (a.percent / 100) * coreAmount,
        })),
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

// Simulate Power Pass-Up distribution without actually crediting (for potential calculations)
async function simulatePowerPassUp({ originUserId, coreAmount, referenceId, trx = db }) {
  if (!coreAmount || coreAmount <= 0) return { distributed: 0, allocations: [] };

  const chain = await getSponsorChain(originUserId, 9);
  const allocations = [];

  let previousRankPercent = 0; // PDF-compliant: always start at 0

  for (const sponsorId of chain) {
    const sponsorRankPercent = await getUserRankPercent(sponsorId, trx);

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
