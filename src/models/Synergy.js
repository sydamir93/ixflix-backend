const db = require('../config/database');
const Stake = require('./Stake');
const Genealogy = require('./Genealogy');
const JobRun = require('./JobRun');

// Synergy Flow rates by pack
const SYNERGY_RATES = {
  spark: 0.05,
  pulse: 0.06,
  charge: 0.08,
  quantum: 0.10
};

const CYCLE_SIZE = 100; // USD100 left + USD100 right = 1 cycle

class Synergy {
  static async ensureVolumeRow(userId, trx = null) {
    const query = trx || db;
    const existing = await query('team_volumes').where({ user_id: userId }).first();
    if (existing) return existing;
    const [row] = await query('team_volumes')
      .insert({ user_id: userId, created_at: query.fn.now(), updated_at: query.fn.now() })
      .returning('*');
    return row;
  }

  // Eligibility: at least 1 active direct on left AND 1 active direct on right with an active stake
  static async hasActiveDirectOnSide(userId, side) {
    const direct = await db('genealogy')
      .join('users', 'genealogy.user_id', 'users.id')
      .where({ parent_id: userId, position: side })
      .andWhere('users.is_verified', true)
      .select('users.id')
      .first();

    if (!direct) return false;
    const stakes = await db('stakes')
      .where({ user_id: direct.id, status: 'active' })
      .first();
    return !!stakes;
  }

  static async getEligibility(userId) {
    const leftActive = await this.hasActiveDirectOnSide(userId, 'left');
    const rightActive = await this.hasActiveDirectOnSide(userId, 'right');
    const eligible = leftActive && rightActive;
    return {
      eligible,
      reasons: eligible ? [] : ['Need 1 active direct on each side'],
      leftActive,
      rightActive
    };
  }

  // Add volume to uplines along binary parent chain, using child's position (left/right)
  static async addVolumeToUplines(userId, amount, trx = null) {
    const query = trx || db;
    let currentChildId = userId;

    // Traverse upwards
    while (true) {
      const node = await query('genealogy').where({ user_id: currentChildId }).first();
      if (!node || !node.parent_id) break;

      const parentId = node.parent_id;
      const position = node.position; // 'left' or 'right'

      await this.ensureVolumeRow(parentId, query);

      if (position === 'left') {
        await query('team_volumes')
          .where({ user_id: parentId })
          .increment('left_volume', amount)
          .update({ updated_at: query.fn.now() });
      } else if (position === 'right') {
        await query('team_volumes')
          .where({ user_id: parentId })
          .increment('right_volume', amount)
          .update({ updated_at: query.fn.now() });
      }

      currentChildId = parentId;
    }
  }

  static resetDailyIfNeeded(volumeRow, todayStr, trx = null) {
    const query = trx || db;
    if (volumeRow.last_reset_date === todayStr) return volumeRow;

    return query('team_volumes')
      .where({ user_id: volumeRow.user_id })
      .update({
        daily_paid: 0,
        last_reset_date: todayStr,
        updated_at: query.fn.now()
      })
      .then(async () => {
        const refreshed = await query('team_volumes').where({ user_id: volumeRow.user_id }).first();
        return refreshed || volumeRow;
      });
  }

  static async getUserRateAndCap(userId) {
    const { highestPack, totalAmount } = await Stake.getUserActivePackInfo(userId);
    const rate = highestPack ? SYNERGY_RATES[highestPack] || 0 : 0;
    return { rate, packType: highestPack, cap: totalAmount };
  }

  static async processUserCycles(userId, trx = null) {
    const query = trx || db;
    const volumeRow = await this.ensureVolumeRow(userId, query);
    const todayStr = new Date().toISOString().split('T')[0];
    const freshRow = await this.resetDailyIfNeeded(volumeRow, todayStr, query);

    const leftTotal = Number(freshRow.left_volume || 0) + Number(freshRow.left_carry || 0);
    const rightTotal = Number(freshRow.right_volume || 0) + Number(freshRow.right_carry || 0);

    if (leftTotal < CYCLE_SIZE || rightTotal < CYCLE_SIZE) {
      return { cycles: 0, reward: 0 };
    }

    const { rate, packType, cap } = await this.getUserRateAndCap(userId);
    const eligibility = await this.getEligibility(userId);
    if (!eligibility.eligible) {
      return { cycles: 0, reward: 0, ineligible: true };
    }
    if (!rate || cap <= 0) {
      // Not eligible (no active pack)
      return { cycles: 0, reward: 0 };
    }

    const cyclesAvailable = Math.floor(Math.min(leftTotal, rightTotal) / CYCLE_SIZE);
    if (cyclesAvailable <= 0) return { cycles: 0, reward: 0, eligible: true };

    const perCycleReward = CYCLE_SIZE * rate;
    const remainingCap = Math.max(0, Number(cap) - Number(freshRow.daily_paid || 0));
    const maxCyclesByCap = Math.floor(remainingCap / perCycleReward);
    const cyclesToPay = Math.min(cyclesAvailable, maxCyclesByCap);
    if (cyclesToPay <= 0) {
      // Cap reached; flush weaker leg and carry stronger forward
      const weaker = Math.min(leftTotal, rightTotal);
      const stronger = Math.max(leftTotal, rightTotal);
      const isLeftWeaker = leftTotal <= rightTotal;
      const newLeftCarry = isLeftWeaker ? 0 : stronger - weaker;
      const newRightCarry = isLeftWeaker ? stronger - weaker : 0;
      await query('team_volumes')
        .where({ user_id: userId })
        .update({
          left_volume: 0,
          right_volume: 0,
          left_carry: newLeftCarry,
          right_carry: newRightCarry,
          updated_at: query.fn.now()
        });
      return { cycles: 0, reward: 0, eligible: true, capReached: true };
    }

    let rewardAmount = cyclesToPay * perCycleReward;
    // Apply combined cap for incentive rewards
    const { allowed } = await RewardCap.clampIncentive(userId, rewardAmount, query);
    const capApplied = allowed < rewardAmount;
    rewardAmount = allowed;
    if (rewardAmount <= 0) {
      // Nothing to pay; treat as cap reached
      return { cycles: 0, reward: 0, eligible: true, capReached: true };
    }
    const usedVolume = cyclesToPay * CYCLE_SIZE;
    const newLeft = leftTotal - usedVolume;
    const newRight = rightTotal - usedVolume;

    // Update carries and zero out temp volumes
    await query('team_volumes')
      .where({ user_id: userId })
      .update({
        left_volume: 0,
        right_volume: 0,
        left_carry: newLeft,
        right_carry: newRight,
        daily_paid: Number(freshRow.daily_paid || 0) + rewardAmount,
        last_reset_date: todayStr,
        updated_at: query.fn.now()
      });

    // Record cycle history
    await query('team_cycles').insert({
      user_id: userId,
      cycle_date: todayStr,
      cycles: cyclesToPay,
      left_used: usedVolume,
      right_used: usedVolume,
      weaker_leg_volume: usedVolume,
      reward_amount: rewardAmount,
      rate_used: rate,
      pack_type: packType,
      status: 'completed',
      created_at: query.fn.now(),
      updated_at: query.fn.now()
    });

    // Credit wallet and transaction
    await query.transaction(async (innerTrx) => {
      await innerTrx('wallets')
        .where({ user_id: userId, wallet_type: 'main' })
        .increment('balance', rewardAmount);

      await innerTrx('transactions').insert({
        user_id: userId,
        wallet_type: 'main',
        transaction_type: 'synergy_flow',
        reference_type: 'team_cycle',
        reference_id: `${userId}-${todayStr}`,
        amount: rewardAmount,
        currency: 'USD',
        status: 'completed',
        description: `Synergy Flow payout (${cyclesToPay} cycles @ ${rate * 100}%)`,
        created_at: innerTrx.fn.now(),
        updated_at: innerTrx.fn.now()
      });
    });

    return { cycles: cyclesToPay, reward: rewardAmount, packType, eligible: true };
  }

  static async processAllUsers() {
    const todayStr = new Date().toISOString().split('T')[0];
    const existing = await JobRun.getStatus('synergy_flow');
    if (existing && existing.run_date === todayStr && existing.status === 'success') {
      return { skipped: true, message: 'already ran today' };
    }

    await JobRun.start('synergy_flow', todayStr, { note: 'Synergy daily payout' });

    const users = await db('team_volumes').select('user_id');
    let processed = 0;
    let cycles = 0;
    let rewards = 0;
    let capHits = 0;
    let ineligible = 0;

    for (const u of users) {
      const result = await this.processUserCycles(u.user_id);
      processed += 1;
      cycles += result.cycles || 0;
      rewards += result.reward || 0;
      if (result.capReached) capHits += 1;
      if (result.ineligible) ineligible += 1;
    }

    await JobRun.finish('synergy_flow', todayStr, 'success', {
      processed,
      cycles,
      rewards,
      capHits,
      ineligible
    });

    return { users: processed, cycles, rewards, capHits, ineligible };
  }

  static async getUserSummary(userId) {
    const volumeRow = await this.ensureVolumeRow(userId);
    const todayStr = new Date().toISOString().split('T')[0];
    const { rate, packType, cap } = await this.getUserRateAndCap(userId);
    const eligibility = await this.getEligibility(userId);
    const leftTotal = Number(volumeRow.left_volume || 0) + Number(volumeRow.left_carry || 0);
    const rightTotal = Number(volumeRow.right_volume || 0) + Number(volumeRow.right_carry || 0);
    const cyclesAvailable = Math.floor(Math.min(leftTotal, rightTotal) / CYCLE_SIZE);
    const perCycleReward = rate ? CYCLE_SIZE * rate : 0;
    const remainingCap = Math.max(0, cap - Number(volumeRow.daily_paid || 0));

    return {
      user_id: userId,
      left_total: leftTotal,
      right_total: rightTotal,
      left_carry: Number(volumeRow.left_carry || 0),
      right_carry: Number(volumeRow.right_carry || 0),
      daily_paid: Number(volumeRow.daily_paid || 0),
      last_reset_date: volumeRow.last_reset_date,
      rate,
      pack_type: packType,
      cap,
      per_cycle_reward: perCycleReward,
      cycles_available: cyclesAvailable,
      remaining_cap: remainingCap,
      today: todayStr,
      eligible: eligibility.eligible,
      eligibility_reasons: eligibility.reasons || [],
      left_active_direct: eligibility.leftActive,
      right_active_direct: eligibility.rightActive
    };
  }

  static async getUserHistory(userId, { limit = 20, offset = 0 } = {}) {
    return db('team_cycles')
      .where({ user_id: userId })
      .orderBy('cycle_date', 'desc')
      .limit(limit)
      .offset(offset);
  }

  static async getAllHistory({ limit = 50, offset = 0 } = {}) {
    return db('team_cycles')
      .select('team_cycles.*', 'users.name')
      .leftJoin('users', 'users.id', 'team_cycles.user_id')
      .orderBy('cycle_date', 'desc')
      .limit(limit)
      .offset(offset);
  }
}

module.exports = Synergy;

