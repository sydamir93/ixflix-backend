const db = require('../config/database');
const { distributePowerPassUp } = require('./PowerPassUp');
const RewardCap = require('./RewardCap');
const JobRun = require('./JobRun');

// Energy pack configurations based on IXFLIX Reward Plan
// Now supports dynamic share-based staking
const ENERGY_PACKS = {
  spark: {
    minShares: 1,
    maxShares: 9,
    dailyRoiRate: 0.0030, // 0.3%
    maxRewardLimit: 200 // 200% total limit
  },
  pulse: {
    minShares: 10,
    maxShares: 99,
    dailyRoiRate: 0.0050, // 0.5%
    maxRewardLimit: 300 // 300% total limit
  },
  charge: {
    minShares: 100,
    maxShares: 999,
    dailyRoiRate: 0.0070, // 0.7%
    maxRewardLimit: 400 // 400% total limit
  },
  quantum: {
    minShares: 1000,
    maxShares: null, // unlimited
    dailyRoiRate: 0.0100, // 1.0%
    maxRewardLimit: 500 // 500% total limit
  }
};

class Stake {
  // Create a new stake
  static async create(data) {
    const packConfig = ENERGY_PACKS[data.pack_type];
    if (!packConfig) {
      throw new Error('Invalid pack type');
    }

    // Calculate shares from amount (1 share = $25)
    const shares = Math.floor(parseFloat(data.amount) / 25);
    if (shares < 1) {
      throw new Error('Minimum stake amount is $25 (1 share)');
    }

    // Validate shares are in the correct range for the pack
    if (shares < packConfig.minShares ||
        (packConfig.maxShares && shares > packConfig.maxShares)) {
      throw new Error(`Invalid share count for ${data.pack_type} pack. Required: ${packConfig.minShares}${packConfig.maxShares ? `-${packConfig.maxShares}` : '+'} shares`);
    }

    // Insert and get the insert ID (MySQL compatible)
    const [insertId] = await db('stakes').insert({
      user_id: data.user_id,
      pack_type: data.pack_type,
      shares: shares,
      amount: data.amount,
      daily_roi_rate: packConfig.dailyRoiRate,
      max_reward_limit: packConfig.maxRewardLimit,
      status: 'active',
      last_reward_calculation: db.fn.now(),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Fetch the created stake
    const stake = await db('stakes')
      .where({ id: insertId })
      .first();

    return stake;
  }

  // Create a new stake within a transaction
  static async createWithTransaction(data, trx) {
    const packConfig = ENERGY_PACKS[data.pack_type];
    if (!packConfig) {
      throw new Error('Invalid pack type');
    }

    // Calculate shares from amount (1 share = $25)
    const shares = Math.floor(parseFloat(data.amount) / 25);
    if (shares < 1) {
      throw new Error('Minimum stake amount is $25 (1 share)');
    }

    // Validate shares are in the correct range for the pack
    if (shares < packConfig.minShares ||
        (packConfig.maxShares && shares > packConfig.maxShares)) {
      throw new Error(`Invalid share count for ${data.pack_type} pack. Required: ${packConfig.minShares}${packConfig.maxShares ? `-${packConfig.maxShares}` : '+'} shares`);
    }

    // Insert and get the insert ID (MySQL compatible)
    const [insertId] = await trx('stakes').insert({
      user_id: data.user_id,
      pack_type: data.pack_type,
      shares: shares,
      amount: data.amount,
      daily_roi_rate: packConfig.dailyRoiRate,
      max_reward_limit: packConfig.maxRewardLimit,
      status: 'active',
      last_reward_calculation: trx.fn.now(),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });

    // Fetch the created stake
    const stake = await trx('stakes')
      .where({ id: insertId })
      .first();

    return stake;
  }

  // Find stake by ID
  static async findById(id) {
    return await db('stakes')
      .where({ id })
      .first();
  }

  // Find stakes by user ID
  static async findByUserId(userId, filters = {}) {
    let query = db('stakes')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');

    if (filters.pack_type) {
      query = query.where({ pack_type: filters.pack_type });
    }

    if (filters.status) {
      query = query.where({ status: filters.status });
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    return await query;
  }

  // Get all active stakes (for cron jobs)
  static async getAllActive() {
    return await db('stakes')
      .where({ status: 'active' })
      .orderBy('created_at', 'asc');
  }

  // Get highest active pack type and total active amount for a user
  static async getUserActivePackInfo(userId) {
    const stakes = await db('stakes')
      .where({ user_id: userId, status: 'active' });

    if (!stakes || stakes.length === 0) {
      return { highestPack: null, totalAmount: 0 };
    }

    // Determine highest pack by priority: quantum > charge > pulse > spark
    const priority = { quantum: 4, charge: 3, pulse: 2, spark: 1 };
    let highestPack = null;
    let totalAmount = 0;

    stakes.forEach((s) => {
      totalAmount += Number(s.amount || 0);
      const p = priority[s.pack_type] || 0;
      if (!highestPack || p > (priority[highestPack] || 0)) {
        highestPack = s.pack_type;
      }
    });

    return { highestPack, totalAmount };
  }

  // Get user's active stakes summary
  static async getUserStakeSummary(userId) {
    const stakes = await this.findByUserId(userId, { status: 'active' });

    const summary = {
      totalStaked: 0,
      totalShares: 0,
      activePacks: {},
      totalRewardsEarned: 0,
      packCounts: {
        spark: 0,
        pulse: 0,
        charge: 0,
        quantum: 0
      }
    };

    stakes.forEach(stake => {
      summary.totalStaked += parseFloat(stake.amount);
      summary.totalShares += stake.shares;
      summary.totalRewardsEarned += parseFloat(stake.total_rewards_earned);

      if (!summary.activePacks[stake.pack_type]) {
        summary.activePacks[stake.pack_type] = [];
      }
      summary.activePacks[stake.pack_type].push(stake);
      summary.packCounts[stake.pack_type]++;
    });

    return summary;
  }

  // Aggregate pending rewards (core + harvest) across all stakes for a user
  static async getPendingRewardsSummaryForUser(userId) {
    const aggregates = await db('stake_rewards')
      .join('stakes', 'stake_rewards.stake_id', 'stakes.id')
      .where('stakes.user_id', userId)
      .where('stake_rewards.status', 'pending')
      .sum({
        core: 'stake_rewards.core_reward',
        harvest: 'stake_rewards.harvest_reward',
        total: 'stake_rewards.total_reward'
      })
      .count({ pending_count: 'stake_rewards.id' })
      .first();

    const perPackRows = await db('stake_rewards')
      .join('stakes', 'stake_rewards.stake_id', 'stakes.id')
      .where('stakes.user_id', userId)
      .where('stake_rewards.status', 'pending')
      .select('stakes.pack_type')
      .sum({
        core: 'stake_rewards.core_reward',
        harvest: 'stake_rewards.harvest_reward',
        total: 'stake_rewards.total_reward'
      })
      .count({ pending_count: 'stake_rewards.id' })
      .groupBy('stakes.pack_type');

    const perPack = {};
    perPackRows.forEach((row) => {
      perPack[row.pack_type] = {
        core: Number(row.core || 0),
        harvest: Number(row.harvest || 0),
        total: Number(row.total || 0),
        pendingCount: Number(row.pending_count || 0)
      };
    });

    return {
      core: Number(aggregates?.core || 0),
      harvest: Number(aggregates?.harvest || 0),
      total: Number(aggregates?.total || 0),
      pendingCount: Number(aggregates?.pending_count || 0),
      perPack
    };
  }

  // Calculate performance-based Harvest Energy reward for a given date
  static async calculateHarvestRewardForDate(stake, dateStr) {
    // Total platform sales for the date (configurable source)
    const source = (process.env.HARVEST_SALES_SOURCE || 'stakes').toLowerCase(); // stakes | deposits | combined
    let totalSales = 0;

    if (source === 'deposits' || source === 'combined') {
      const depRow = await db('transactions')
        .whereRaw('DATE(created_at) = ?', [dateStr])
        .where({ transaction_type: 'deposit', status: 'completed' })
        .sum({ total: 'amount' })
        .first();
      totalSales += parseFloat(depRow?.total || 0);
    }

    if (source === 'stakes' || source === 'combined' || !source) {
      const stakeRow = await db('transactions')
        .whereRaw('DATE(created_at) = ?', [dateStr])
        .where({ transaction_type: 'stake', status: 'completed' })
        .sum({ total: db.raw('ABS(amount)') })
        .first();
      totalSales += parseFloat(stakeRow?.total || 0);
    }

    if (totalSales <= 0) return 0;

    const rewardPool = totalSales * 0.20; // 20% allocation

    // Total active shares across all active stakes
    const sharesRow = await db('stakes')
      .where({ status: 'active' })
      .sum({ shares_sum: 'shares' })
      .first();
    const totalShares = parseFloat(sharesRow?.shares_sum || 0);
    if (totalShares <= 0) return 0;

    const perShareReward = rewardPool / totalShares;
    const rawHarvest = perShareReward * parseFloat(stake.shares);

    // Daily harvest cap: up to 5% of stake amount
    const dailyCap = parseFloat(stake.amount) * 0.05;
    return Math.min(rawHarvest, dailyCap);
  }

  // Calculate daily rewards for a stake
  static async calculateDailyReward(stakeId, rewardDate = new Date()) {
    const stake = await this.findById(stakeId);
    if (!stake || stake.status !== 'active') {
      return null;
    }

    const dateStr = rewardDate.toISOString().split('T')[0];

    // Check if reward already exists for this date
    const existingReward = await db('stake_rewards')
      .where({ stake_id: stakeId, reward_date: dateStr })
      .first();

    if (existingReward) {
      return existingReward;
    }

    // Calculate core energy reward (fixed daily ROI)
    const coreReward = parseFloat(stake.amount) * parseFloat(stake.daily_roi_rate);

    // Calculate harvest energy reward (performance-based up to 5% daily)
    const harvestReward = await this.calculateHarvestRewardForDate(stake, dateStr);

    const totalReward = coreReward + harvestReward;

    // Note: reward cap is enforced at claim time; we still create pending rewards here.
    await db('stake_rewards').insert({
      stake_id: stakeId,
      reward_date: dateStr,
      core_reward: coreReward,
      harvest_reward: harvestReward,
      total_reward: totalReward,
      status: 'pending',
      created_at: db.fn.now()
    });

    return await db('stake_rewards')
      .where({ stake_id: stakeId, reward_date: dateStr })
      .first();
  }

  // Credit pending rewards to user's wallet
  static async creditPendingRewards(stakeId, rewardIds = null) {
    return await db.transaction(async (trx) => {
      let rewardsQuery = trx('stake_rewards')
        .where({ stake_id: stakeId, status: 'pending' });

      if (rewardIds) {
        rewardsQuery = rewardsQuery.whereIn('id', rewardIds);
      }

      const pendingRewards = await rewardsQuery.orderBy('reward_date', 'asc');

      if (pendingRewards.length === 0) {
        return { credited: 0, totalAmount: 0 };
      }

      const stake = await trx('stakes').where({ id: stakeId }).first();
      const maxRewards = parseFloat(stake.amount) * (parseFloat(stake.max_reward_limit) / 100);
      let currentTotalRewards = parseFloat(stake.total_rewards_earned || 0);
      let totalCredited = 0;
      let passupSkips = 0;
      let passupAllocations = 0;

      for (const reward of pendingRewards) {
        // Expire rewards older than 24h (reward_date before today is considered expired by cron, but guard here too)
        const rewardDate = new Date(`${reward.reward_date}T00:00:00Z`);
        const nowUtc = new Date();
        if (nowUtc.getTime() - rewardDate.getTime() > 24 * 3600 * 1000) {
          await trx('stake_rewards')
            .where({ id: reward.id })
            .update({ status: 'expired', updated_at: trx.fn.now() });
          continue;
        }

        // Apply remaining cap at claim time
        const remainingCap = maxRewards - currentTotalRewards;
        if (remainingCap <= 0) {
          await trx('stake_rewards')
            .where({ id: reward.id })
            .update({ status: 'expired', updated_at: trx.fn.now() });
          continue;
        }

        const rawRewardAmount = parseFloat(reward.total_reward);
        const rawCoreAmount = parseFloat(reward.core_reward || 0);
        const ratio = rawRewardAmount > remainingCap ? remainingCap / rawRewardAmount : 1;
        const rewardAmount = rawRewardAmount * ratio;
        const coreAmount = rawCoreAmount * ratio;
        const harvestAmount = (parseFloat(reward.harvest_reward || 0)) * ratio;

        // Calculate staker's entitled portion of core reward
        const { getUserRankPercent } = require('./PowerPassUp');
        const stakerRankPercent = await getUserRankPercent(stake.user_id, trx);
        const stakerCorePortion = coreAmount * (stakerRankPercent / 100);
        const stakerTotalCredit = harvestAmount + stakerCorePortion;

        // Credit to user's wallet (harvest + staker's core portion)
        await trx('wallets')
          .where({ user_id: stake.user_id, wallet_type: 'main' })
          .increment('balance', stakerTotalCredit);

        // Create transaction record
        await trx('transactions').insert({
          user_id: stake.user_id,
          wallet_type: 'main',
          transaction_type: 'stake_reward',
          reference_type: 'stake_reward',
          reference_id: reward.id.toString(),
          amount: stakerTotalCredit,
          currency: 'USD',
          status: 'completed',
          description: `Stake reward for ${stake.pack_type} pack (${stakerRankPercent}% core share) - ${reward.reward_date}`,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });

        // Power Pass-Up on remaining Core Energy Reward portion
        const remainingCoreAmount = coreAmount - stakerCorePortion;

        // For PDF-compliant, we ignore staker rank; baseline = 0
        if (remainingCoreAmount > 0) {
          const passRes = await distributePowerPassUp({
            originUserId: stake.user_id,
            coreAmount: remainingCoreAmount,
            referenceId: reward.id,
            trx
          });
          passupAllocations += passRes.allocations?.length || 0;
          // Track skips (optional)
          if ((passRes.distributed || 0) <= 0) passupSkips += 1;
        }

        // Update reward status
        await trx('stake_rewards')
          .where({ id: reward.id })
          .update({
            status: 'credited',
            core_reward: coreAmount,
            harvest_reward: harvestAmount,
            total_reward: rewardAmount,
            credited_at: trx.fn.now()
          });

        totalCredited += rewardAmount;
        currentTotalRewards += rewardAmount;
      }

      if (totalCredited > 0) {
        await trx('stakes')
          .where({ id: stakeId })
          .update({
            total_rewards_earned: currentTotalRewards,
            updated_at: trx.fn.now()
          });
        if (currentTotalRewards >= maxRewards) {
          await trx('stakes')
            .where({ id: stakeId })
            .update({
              status: 'completed',
              updated_at: trx.fn.now()
            });
        }
      }

      return { credited: pendingRewards.length, totalAmount: totalCredited, passupSkips, passupAllocations };
    });
  }

  // Expire pending rewards older than 24h (run daily in cron)
  static async expirePendingRewards(runDate = new Date()) {
    const dateStr = typeof runDate === 'string' ? runDate : runDate.toISOString().split('T')[0];
    // Expire anything with reward_date before current run date
    const expired = await db('stake_rewards')
      .where('reward_date', '<', dateStr)
      .andWhere({ status: 'pending' })
      .update({ status: 'expired', updated_at: db.fn.now() });
    return expired;
  }

  // Update stake status
  static async updateStatus(id, status) {
    await db('stakes')
      .where({ id })
      .update({
        status,
        updated_at: db.fn.now()
      });

    return await db('stakes').where({ id }).first();
  }

  // Get stake rewards history
  static async getStakeRewards(stakeId, filters = {}) {
    let query = db('stake_rewards')
      .where({ stake_id: stakeId })
      .orderBy('reward_date', 'desc');

    if (filters.status) {
      query = query.where({ status: filters.status });
    }

    if (filters.start_date) {
      query = query.where('reward_date', '>=', filters.start_date);
    }

    if (filters.end_date) {
      query = query.where('reward_date', '<=', filters.end_date);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    return await query;
  }

  // Get energy pack configuration
  static getPackConfig(packType) {
    return ENERGY_PACKS[packType] || null;
  }

  // Get all available pack types
  static getAvailablePacks() {
    return Object.keys(ENERGY_PACKS).map(packType => ({
      type: packType,
      ...ENERGY_PACKS[packType]
    }));
  }

  // Validate stake amount for pack type
  static validateStakeAmount(packType, amount) {
    const packConfig = ENERGY_PACKS[packType];
    if (!packConfig) {
      return { valid: false, error: 'Invalid pack type' };
    }

    const numAmount = parseFloat(amount);
    const shares = Math.floor(numAmount / 25);

    if (shares < 1) {
      return { valid: false, error: 'Minimum stake amount is $25 (1 share)' };
    }

    if (shares < packConfig.minShares ||
        (packConfig.maxShares && shares > packConfig.maxShares)) {
      return {
        valid: false,
        error: `Invalid share count for ${packType} pack. Required: ${packConfig.minShares}${packConfig.maxShares ? `-${packConfig.maxShares}` : '+'} shares`
      };
    }

    return { valid: true };
  }

  // Get pack type for share count
  static getPackForShares(shareCount) {
    const shares = parseInt(shareCount);
    if (shares >= 1000) return 'quantum';
    if (shares >= 100) return 'charge';
    if (shares >= 10) return 'pulse';
    if (shares >= 1) return 'spark';
    return null;
  }

  // Get pack max reward limit (%)
  static getPackMaxLimit(packType) {
    const cfg = ENERGY_PACKS[packType];
    return cfg?.maxRewardLimit || null;
  }

  // Run daily core/harvest rewards (idempotent per day via job_runs)
  static async runDailyCoreHarvest(runDate = new Date()) {
    const dateStr = typeof runDate === 'string' ? runDate : runDate.toISOString().split('T')[0];
    const existing = await JobRun.getStatus('core_harvest');
    if (existing && existing.run_date === dateStr && existing.status === 'success') {
      return { skipped: true, message: 'already ran today' };
    }

    await JobRun.start('core_harvest', dateStr, { note: 'Daily core+harvest' });

    const expired = await Stake.expirePendingRewards(runDate);

    const activeStakes = await db('stakes')
      .where({ status: 'active' })
      .select('id');

    let processed = 0;
    let rewardsCreated = 0;
    let capHits = 0;

    for (const stake of activeStakes) {
      const reward = await Stake.calculateDailyReward(stake.id, runDate);
      if (reward) {
        rewardsCreated++;
      } else {
        const st = await Stake.findById(stake.id);
        if (st && st.status === 'completed') capHits++;
      }
      processed++;
    }

    await JobRun.finish('core_harvest', dateStr, 'success', {
      processed,
      rewardsCreated,
      capHits,
      expired
    });

    return { stakes_processed: processed, rewards_created: rewardsCreated, capHits, expired };
  }
}

module.exports = Stake;
