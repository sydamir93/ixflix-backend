const db = require('../config/database');
const Stake = require('./Stake');

// Rank ladder aligned to Energy Spectrum (percent is Power Pass-Up override)
const RANK_LADDER = [
  { key: 'spark', minDirects: 1, minPackValue: 25, teamVolume: 1000, percent: 5 },
  { key: 'pulse', minDirects: 2, minPackValue: 250, teamVolume: 5000, percent: 10 },
  { key: 'charge', minDirects: 3, minPackValue: 500, teamVolume: 15000, percent: 15 },
  { key: 'surge', minDirects: 4, minPackValue: 1000, teamVolume: 50000, percent: 25 },
  { key: 'flux', minDirects: 5, minPackValue: 2500, teamVolume: 100000, percent: 40 },
  { key: 'volt', minDirects: 6, minPackValue: 5000, teamVolume: 250000, percent: 55 },
  { key: 'current', minDirects: 7, minPackValue: 10000, teamVolume: 500000, percent: 70 },
  { key: 'magnet', minDirects: 8, minPackValue: 25000, teamVolume: 1000000, percent: 85 },
  { key: 'quantum', minDirects: 9, minPackValue: 50000, teamVolume: 2000000, percent: 100 },
];

async function ensureRankRow(userId, trx = null) {
  const query = trx || db;
  const existing = await query('user_ranks').where({ user_id: userId }).first();
  if (existing) return existing;

  try {
    const [row] = await query('user_ranks')
      .insert({
        user_id: userId,
        rank: 'unranked',
        override_percent: 0,
        created_at: query.fn.now(),
        updated_at: query.fn.now()
      })
      .returning('*');
    // MySQL may return an empty array on returning(); fall back to select
    return row || (await query('user_ranks').where({ user_id: userId }).first());
  } catch (err) {
    // If another request inserted concurrently, return the existing row
    if (err && (err.code === 'ER_DUP_ENTRY' || err.code === 'SQLITE_CONSTRAINT')) {
      return await query('user_ranks').where({ user_id: userId }).first();
    }
    throw err;
  }
}

async function getDirectReferralsCount(userId) {
  const row = await db('genealogy')
    .where({ sponsor_id: userId })
    .count('id as count')
    .first();
  return parseInt(row?.count || 0);
}

async function getDownlineUserIds(userId) {
  const queue = [userId];
  const ids = [];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = await db('genealogy')
      .where({ sponsor_id: current })
      .select('user_id');
    for (const child of children) {
      ids.push(child.user_id);
      queue.push(child.user_id);
    }
  }
  return ids;
}

async function getTeamSalesVolume(userId) {
  const downlineIds = await getDownlineUserIds(userId);
  if (downlineIds.length === 0) return 0;
  const row = await db('stakes')
    .whereIn('user_id', downlineIds)
    .sum({ total: 'amount' })
    .first();
  return parseFloat(row?.total || 0);
}

async function getHighestPackAmount(userId) {
  const { highestPack, totalAmount } = await Stake.getUserActivePackInfo(userId);
  return { pack: highestPack, amount: totalAmount };
}

function computeProgress(current, target) {
  if (!target) return { nextRank: null, percent: 100, remaining: {} };
  const pct = Math.min(
    100,
    Math.max(
      0,
      Math.floor(
        Math.min(
          current.directReferrals / target.minDirects,
          current.packAmount / target.minPackValue,
          current.teamVolume / target.teamVolume
        ) * 100
      )
    )
  );
  return {
    nextRank: target.key,
    percent: isFinite(pct) ? pct : 0,
    remaining: {
      directs: Math.max(0, target.minDirects - current.directReferrals),
      packAmount: Math.max(0, target.minPackValue - current.packAmount),
      teamVolume: Math.max(0, target.teamVolume - current.teamVolume)
    }
  };
}

async function evaluateUserRank(userId) {
  const directReferrals = await getDirectReferralsCount(userId);
  const { amount: packAmount } = await getHighestPackAmount(userId);
  const teamVolume = await getTeamSalesVolume(userId);

  // Find highest rank met
  let target = null;
  for (const r of RANK_LADDER) {
    if (
      directReferrals >= r.minDirects &&
      packAmount >= r.minPackValue &&
      teamVolume >= r.teamVolume
    ) {
      target = r;
    }
  }

  return {
    directReferrals,
    packAmount,
    teamVolume,
    targetRank: target ? target.key : null,
    targetPercent: target ? target.percent : 0
  };
}

async function getRankProgress(userId) {
  const directReferrals = await getDirectReferralsCount(userId);
  const { amount: packAmount } = await getHighestPackAmount(userId);
  const teamVolume = await getTeamSalesVolume(userId);
  const current = await ensureRankRow(userId);

  // Find next rank above current percent
  const ladderByPercent = RANK_LADDER.sort((a, b) => a.percent - b.percent);
  const next = [...ladderByPercent].find((r) => r.percent > Number(current.override_percent || 0));

  const progress = computeProgress(
    { directReferrals, packAmount, teamVolume },
    next || null
  );

  return {
    currentRank: current.rank,
    currentPercent: Number(current.override_percent || 0),
    directReferrals,
    packAmount,
    teamVolume,
    nextRank: progress.nextRank,
    progressPercent: progress.percent,
    remaining: progress.remaining
  };
}

async function setUserRank(userId, rankKey, percentOverride = null, trx = null) {
  const query = trx || db;
  const percent = percentOverride ?? (RANK_LADDER.find(r => r.key === rankKey)?.percent || 0);
  const row = await ensureRankRow(userId, query);
  await query('user_ranks')
    .where({ user_id: userId })
    .update({
      rank: rankKey,
      override_percent: percent,
      updated_at: query.fn.now()
    });
  const updated = await query('user_ranks').where({ user_id: userId }).first();
  return updated || row;
}

async function autoPromoteUser(userId) {
  const current = await ensureRankRow(userId);
  const evalResult = await evaluateUserRank(userId);
  const currentPercent = Number(current.override_percent || 0);

  // No eligible rank
  if (!evalResult.targetRank) {
    if (currentPercent > 0) {
      const updated = await setUserRank(userId, 'unranked', 0);
      return { promoted: false, demoted: true, rank: updated.rank, percent: updated.override_percent };
    }
    return { promoted: false, demoted: false, rank: current.rank, percent: current.override_percent };
  }

  // Demote if current > target
  if (evalResult.targetPercent < currentPercent) {
    const updated = await setUserRank(userId, evalResult.targetRank, evalResult.targetPercent);
    return { promoted: false, demoted: true, rank: updated.rank, percent: updated.override_percent };
  }

  // Promote if target higher
  if (evalResult.targetPercent > currentPercent) {
    const updated = await setUserRank(userId, evalResult.targetRank, evalResult.targetPercent);
    return { promoted: true, demoted: false, rank: updated.rank, percent: updated.override_percent };
  }

  return { promoted: false, demoted: false, rank: current.rank, percent: current.override_percent };
}

async function autoPromoteAll() {
  const users = await db('users').select('id');
  let promoted = 0;
  let demoted = 0;
  for (const u of users) {
    const res = await autoPromoteUser(u.id);
    if (res.promoted) promoted++;
    if (res.demoted) demoted++;
  }
  return { users: users.length, promoted, demoted };
}

module.exports = {
  RANK_LADDER,
  ensureRankRow,
  evaluateUserRank,
  setUserRank,
  autoPromoteUser,
  autoPromoteAll,
  getRankProgress
};

