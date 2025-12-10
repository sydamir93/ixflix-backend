const Stake = require('../models/Stake');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Synergy = require('../models/Synergy');
const RewardCap = require('../models/RewardCap');
const db = require('../config/database');
const { getRankProgress } = require('../models/Rank');

// Catalyst Bonus percentages per level (up to 9 levels) from the reward plan
const CATALYST_LEVEL_RATES = [0.09, 0.03, 0.01, 0.005, 0.005, 0.0025, 0.0025, 0.0025, 0.0025];

/**
 * Distribute Catalyst Bonus up the sponsor chain.
 * - Traverses genealogy via sponsor_id (not binary parent).
 * - Credits main wallet and records a transaction for each eligible upline.
 * - Stops if sponsor chain ends, loops detected, or rates exhausted.
 */
const distributeCatalystBonus = async ({ originUserId, amount, referenceId, trx }) => {
  const query = trx || db;
  const visited = new Set();
  let currentUserId = originUserId;
  const stats = { paid: 0, skippedNoPack: 0, zeroedByCap: 0 };

  // Resolve staker label (name -> referral_code -> user id)
  const stakerProfile = await query('users')
    .where({ id: originUserId })
    .select('name', 'referral_code')
    .first();
  const stakerLabel =
    (stakerProfile?.name && stakerProfile.name.trim()) ||
    stakerProfile?.referral_code ||
    `user #${originUserId}`;

  for (let level = 0; level < CATALYST_LEVEL_RATES.length; level++) {
    // Find the sponsor/upline for the current user
    const genealogy = await query('genealogy')
      .where({ user_id: currentUserId })
      .select('sponsor_id')
      .first();

    const sponsorId = genealogy?.sponsor_id;
    if (!sponsorId || visited.has(sponsorId) || sponsorId === currentUserId) {
      break; // No further upline or loop detected
    }

    visited.add(sponsorId);

      const rate = CATALYST_LEVEL_RATES[level];
    // Eligibility: sponsor must have an active pack
    const { highestPack } = await Stake.getUserActivePackInfo(sponsorId);
    if (!highestPack) {
      stats.skippedNoPack += 1;
      currentUserId = sponsorId;
      continue;
    }

    const rawReward = parseFloat(amount) * rate;
    const { allowed } = await RewardCap.clampIncentive(sponsorId, rawReward, query);

    if (allowed > 0) {
      // Credit sponsor wallet
        await Wallet.updateBalance(sponsorId, allowed, 'add', 'main', trx);

      // Record transaction
      await query('transactions').insert({
        user_id: sponsorId,
        wallet_type: 'main',
        transaction_type: 'catalyst_bonus',
        reference_type: 'stake',
        reference_id: referenceId?.toString?.() || String(referenceId),
          amount: allowed,
        currency: 'USD',
        status: 'completed',
          description: `Catalyst bonus (level ${level + 1}) from ${stakerLabel} stake #${referenceId}`,
        created_at: query.fn.now(),
        updated_at: query.fn.now()
      });
    }
    if (allowed <= 0) stats.zeroedByCap += 1;

    // Move up the chain
    currentUserId = sponsorId;
  }
  return stats;
};

// Promote ranks for staker and sponsor chain (non-blocking best-effort)
const triggerRankPromotionChain = async (userId) => {
  try {
    const uplines = [];
    let current = userId;
    const maxDepth = 20; // safety cap
    for (let i = 0; i < maxDepth; i++) {
      const node = await db('genealogy').where({ user_id: current }).select('sponsor_id').first();
      if (!node?.sponsor_id || uplines.includes(node.sponsor_id)) break;
      uplines.push(node.sponsor_id);
      current = node.sponsor_id;
    }
    // Promote staker + uplines
    const { autoPromoteUser } = require('../models/Rank');
    const targets = [userId, ...uplines];
    for (const uid of targets) {
      try {
        await autoPromoteUser(uid);
      } catch (err) {
        console.warn('Rank promotion failed for user', uid, err.message);
      }
    }
  } catch (err) {
    console.warn('Rank promotion chain failed', err.message);
  }
};

// Get available energy packs
const getAvailablePacks = async (req, res) => {
  try {
    const packs = Stake.getAvailablePacks();
    res.status(200).json({
      status: 'SUCCESS',
      data: { packs }
    });
  } catch (error) {
    console.error('Get available packs error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Get user's stakes
const getUserStakes = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pack_type, status, page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;
    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    if (pack_type) filters.pack_type = pack_type;
    if (status) filters.status = status;

    const stakes = await Stake.findByUserId(userId, filters);
    const totalCount = stakes.length; // For simplicity, not implementing full pagination count

    res.status(200).json({
      status: 'SUCCESS',
      data: {
        stakes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          total_pages: Math.ceil(totalCount / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get user stakes error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Get user's stake summary
const getUserStakeSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await Stake.getUserStakeSummary(userId);

    res.status(200).json({
      status: 'SUCCESS',
      data: { summary }
    });
  } catch (error) {
    console.error('Get user stake summary error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Get pending rewards summary (core + harvest) for current user
const getPendingRewardsSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await Stake.getPendingRewardsSummaryForUser(userId);

    res.status(200).json({
      status: 'SUCCESS',
      data: { summary }
    });
  } catch (error) {
    console.error('Get pending rewards summary error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Consolidated eligibility + progress for staking UI
const getStakeEligibility = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rank, synergy, stakeSummary, activeInfo, pendingRewards, incentiveCap] = await Promise.all([
      getRankProgress(userId),
      Synergy.getUserSummary(userId),
      Stake.getUserStakeSummary(userId),
      Stake.getUserActivePackInfo(userId),
      Stake.getPendingRewardsSummaryForUser(userId),
      RewardCap.getCapInfo(userId)
    ]);

    res.status(200).json({
      status: 'SUCCESS',
      data: {
        rank,
        synergy,
        stakeSummary,
        activeInfo,
        pendingRewards,
        incentiveCap
      }
    });
  } catch (error) {
    console.error('Get stake eligibility error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Stake amount to energy pack
const createStake = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;

    // Validate input
    if (!amount) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Amount is required'
      });
    }

    const numAmount = parseFloat(amount);
    if (numAmount <= 0) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid amount'
      });
    }

    // Calculate shares and determine pack type
    const shares = Math.floor(numAmount / 25);
    if (shares < 1) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Minimum stake amount is $25 (1 share)'
      });
    }

    const packType = Stake.getPackForShares(shares);
    if (!packType) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid share count. Minimum 1 share required.'
      });
    }

    // Validate pack type and amount
    const validation = Stake.validateStakeAmount(packType, numAmount);
    if (!validation.valid) {
      return res.status(400).json({
        status: 'ERROR',
        message: validation.error
      });
    }

    // Check if user has sufficient balance
    const hasBalance = await Wallet.hasSufficientBalance(userId, numAmount, 'main');
    if (!hasBalance) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Insufficient wallet balance'
      });
    }

    // Create stake and deduct balance in transaction
    const result = await db.transaction(async (trx) => {
      // Create the stake with transaction
      const stake = await Stake.createWithTransaction({
        user_id: userId,
        pack_type: packType,
        amount: numAmount
      }, trx);

      if (!stake || !stake.id) {
        throw new Error('Failed to create stake - no ID returned');
      }

      // Deduct from wallet
      await Wallet.updateBalance(userId, numAmount, 'subtract', 'main', trx);

      // Create transaction record
      await trx('transactions').insert({
        user_id: userId,
        wallet_type: 'main',
        transaction_type: 'stake',
        reference_type: 'stake',
        reference_id: stake.id.toString(),
        amount: -numAmount, // negative for debit
        currency: 'USD',
        status: 'completed',
        description: `Staked ${shares} share${shares > 1 ? 's' : ''} ($${numAmount.toFixed(2)}) to ${packType} pack`,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });

      // Distribute Catalyst Bonus up the referral chain
      const catalystStats = await distributeCatalystBonus({
        originUserId: userId,
        amount: numAmount,
        referenceId: stake.id,
        trx
      });

      // Add volume to Synergy Flow (binary) uplines
      await Synergy.addVolumeToUplines(userId, numAmount, trx);

      return { stake, catalystStats };
    });

    // Fire-and-forget rank promotion checks for staker and sponsor chain
    triggerRankPromotionChain(userId);

    res.status(200).json({
      status: 'SUCCESS',
      message: `Successfully staked ${shares} share${shares > 1 ? 's' : ''} to ${packType} pack`,
      data: {
        stake: result.stake,
        catalyst: result.catalystStats
      }
    });

  } catch (error) {
    console.error('Create stake error:', error);

    let errorMessage = 'Failed to create stake';
    if (error.message) {
      errorMessage += `: ${error.message}`;
    }

    res.status(500).json({
      status: 'ERROR',
      message: errorMessage
    });
  }
};

// Get stake rewards history
const getStakeRewards = async (req, res) => {
  try {
    const userId = req.user.id;
    const { stake_id } = req.params;
    const { status, start_date, end_date, page = 1, limit = 20 } = req.query;

    // Verify stake belongs to user
    const stake = await Stake.findById(stake_id);
    if (!stake || stake.user_id !== userId) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'Stake not found'
      });
    }

    const filters = {
      limit: parseInt(limit),
      offset: (page - 1) * limit
    };

    if (status) filters.status = status;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;

    const rewards = await Stake.getStakeRewards(stake_id, filters);

    // Aggregate totals for reporting (core vs harvest)
    const totals = rewards.reduce(
      (acc, r) => {
        acc.core += Number(r.core_reward || 0);
        acc.harvest += Number(r.harvest_reward || 0);
        acc.total += Number(r.total_reward || 0);
        return acc;
      },
      { core: 0, harvest: 0, total: 0 }
    );

    res.status(200).json({
      status: 'SUCCESS',
      data: {
        stake_id,
        rewards,
        totals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: rewards.length,
          total_pages: Math.ceil(rewards.length / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get stake rewards error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Calculate and credit pending rewards for a stake
const creditStakeRewards = async (req, res) => {
  try {
    const userId = req.user.id;
    const { stake_id } = req.params;
    const { reward_ids } = req.body || {};

    // Verify stake belongs to user
    const stake = await Stake.findById(stake_id);
    if (!stake || stake.user_id !== userId) {
      return res.status(404).json({
        status: 'ERROR',
        message: 'Stake not found'
      });
    }

    const result = await Stake.creditPendingRewards(stake_id, reward_ids);

    res.status(200).json({
      status: 'SUCCESS',
      message: `Credited ${result.credited} rewards totaling $${result.totalAmount.toFixed(2)}`,
      data: result
    });

  } catch (error) {
    console.error('Credit stake rewards error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

// Calculate daily rewards for all active stakes (admin/system function)
const calculateDailyRewards = async (req, res) => {
  try {
    // This would typically be called by a cron job, but allowing manual trigger for now
    // In production, this should be restricted to admin/system access

    const result = await Stake.runDailyCoreHarvest();

    res.status(200).json({
      status: 'SUCCESS',
      message: result.skipped
        ? 'Daily core/harvest already ran today'
        : `Processed ${result.stakes_processed} stakes, created ${result.rewards_created} rewards`,
      data: result
    });

  } catch (error) {
    console.error('Calculate daily rewards error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getAvailablePacks,
  getUserStakes,
  getUserStakeSummary,
  getPendingRewardsSummary,
  getStakeEligibility,
  createStake,
  getStakeRewards,
  creditStakeRewards,
  calculateDailyRewards
};
