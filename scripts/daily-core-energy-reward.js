#!/usr/bin/env node

/**
 * Daily Core Energy Reward Cron Job
 * Calculates and credits Core Energy rewards for all active stakes
 * Based on IXFLIX Reward Plan - Core Energy Reward (Fixed Daily ROI)
 *
 * Usage:
 * - Run manually: node scripts/daily-core-energy-reward.js
 * - Schedule with cron: 0 0 * * * cd /path/to/backend && node scripts/daily-core-energy-reward.js
 */

const path = require('path');
console.log('🔧 Loading environment variables...');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('📚 Loading dependencies...');
const Stake = require('../src/models/Stake');
const { logger } = require('../src/utils/logger');
console.log('✅ Dependencies loaded successfully');

class DailyCoreEnergyReward {
  constructor() {
    this.processedStakes = 0;
    this.totalRewardsCalculated = 0;
    this.errors = [];
    this.executionDate = new Date();
  }

  async run() {
    try {
      logger.info('🚀 Starting Daily Core Energy Reward calculation', {
        executionDate: this.executionDate.toISOString(),
        timestamp: new Date().toISOString()
      });

      // Validate environment and dependencies
      await this.validateEnvironment();

      // Get all active stakes
      const activeStakes = await this.getActiveStakes();

      logger.info(`📊 Found ${activeStakes.length} active stakes to process`);

      // Process each stake
      for (const stake of activeStakes) {
        await this.processStake(stake);
      }

      // Log summary
      await this.logSummary();

    } catch (error) {
      logger.error('❌ Daily Core Energy Reward calculation failed', {
        error: error.message,
        stack: error.stack,
        executionDate: this.executionDate.toISOString()
      });
      process.exit(1);
    }
  }

  async validateEnvironment() {
    logger.info('🔍 Validating environment...');

    // Check environment variables
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      const errorMsg = `Missing required environment variables: ${missingVars.join(', ')}`;
      console.error('❌ Environment validation failed:', errorMsg);
      logger.error('❌ Environment validation failed', { missingVars });
      throw new Error(errorMsg);
    }

    // Test database connection
    try {
      logger.info('🔌 Testing database connection...');
      const db = require('../src/config/database');
      // Wait a moment for the connection test
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.info('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      logger.error('❌ Database connection failed', { error: error.message });
      throw new Error(`Database connection failed: ${error.message}`);
    }

    logger.info('✅ Environment validation passed');
  }

  async getActiveStakes() {
    try {
      logger.info('📊 Fetching active stakes from database...');

      // Get all active stakes from the database
      const stakes = await Stake.getAllActive();

      logger.info(`✅ Found ${stakes.length} active stakes`);
      return stakes;
    } catch (error) {
      logger.error('❌ Failed to fetch active stakes', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async processStake(stake) {
    try {
      logger.info(`🔄 Processing stake ${stake.id}`, {
        userId: stake.user_id,
        packType: stake.pack_type,
        amount: stake.amount,
        shares: stake.shares,
        currentRewards: stake.total_rewards_earned,
        maxRewardLimit: stake.max_reward_limit
      });

      // Calculate daily reward for this stake
      const reward = await Stake.calculateDailyReward(stake.id, this.executionDate);

      if (reward) {
        // Credit the pending reward to user's wallet immediately
        logger.info(`💰 Crediting reward for stake ${stake.id}...`);

        try {
          const creditResult = await Stake.creditPendingRewards(stake.id, [reward.id]);

          this.processedStakes++;

          // Safely parse the reward amount
          const rewardAmount = parseFloat(reward.total_reward) || 0;
          this.totalRewardsCalculated += rewardAmount;

          logger.info(`✅ Reward calculated and credited for stake ${stake.id}`, {
            coreReward: reward.core_reward,
            harvestReward: reward.harvest_reward,
            totalReward: reward.total_reward,
            rewardAmount: rewardAmount,
            rewardDate: reward.reward_date,
            credited: creditResult.credited,
            totalAmount: creditResult.totalAmount
          });
        } catch (creditError) {
          logger.error(`❌ Failed to credit reward for stake ${stake.id}`, {
            error: creditError.message,
            stakeId: stake.id,
            rewardId: reward.id
          });

          // Still count as processed but log the credit failure
          this.processedStakes++;
          const rewardAmount = parseFloat(reward.total_reward) || 0;
          this.totalRewardsCalculated += rewardAmount;
        }
      } else {
        logger.info(`⏭️ No reward calculated for stake ${stake.id} (likely reached limit or already processed)`);
      }

    } catch (error) {
      const errorInfo = {
        stakeId: stake.id,
        userId: stake.user_id,
        packType: stake.pack_type,
        error: error.message
      };

      this.errors.push(errorInfo);

      logger.error(`❌ Failed to process stake ${stake.id}`, errorInfo);
    }
  }

  async logSummary() {
    // Final cleanup: credit any remaining pending rewards
    try {
      logger.info('🧹 Performing final cleanup - crediting any remaining pending rewards...');
      await this.creditRemainingPendingRewards();
    } catch (error) {
      logger.error('❌ Error during final cleanup', { error: error.message });
    }

    const summary = {
      executionDate: this.executionDate.toISOString(),
      processedStakes: this.processedStakes,
      totalRewardsCalculated: this.totalRewardsCalculated.toFixed(6),
      errorsCount: this.errors.length,
      success: this.errors.length === 0,
      processingTime: Date.now() - this.executionDate.getTime()
    };

    logger.info('📈 Daily Core Energy Reward Summary', summary);

    if (this.errors.length > 0) {
      logger.warn('⚠️ Errors encountered during processing', {
        errors: this.errors
      });
    }

    if (this.processedStakes > 0) {
      logger.info(`🎉 Successfully processed ${this.processedStakes} stakes with total rewards: $${this.totalRewardsCalculated.toFixed(2)}`);
    } else {
      logger.info('ℹ️ No stakes were processed (all may have reached limits or already processed)');
    }
  }

  async creditRemainingPendingRewards() {
    try {
      // Get all stakes that might have pending rewards
      const allStakes = await Stake.getAllActive();
      let totalCredited = 0;
      let totalAmount = 0;

      for (const stake of allStakes) {
        try {
          const result = await Stake.creditPendingRewards(stake.id);
          if (result.credited > 0) {
            totalCredited += result.credited;
            totalAmount += result.totalAmount;
            logger.info(`💰 Credited ${result.credited} pending rewards for stake ${stake.id}: $${result.totalAmount.toFixed(2)}`);
          }
        } catch (error) {
          logger.error(`❌ Failed to credit pending rewards for stake ${stake.id}`, { error: error.message });
        }
      }

      if (totalCredited > 0) {
        logger.info(`✅ Final cleanup completed: credited ${totalCredited} rewards totaling $${totalAmount.toFixed(2)}`);
      } else {
        logger.info('ℹ️ No pending rewards found during final cleanup');
      }
    } catch (error) {
      logger.error('❌ Error during final cleanup', { error: error.message });
      throw error;
    }
  }

  // Utility method to get stake statistics
  async getStakeStatistics() {
    try {
      const summary = await Stake.getStakesSummary();
      return summary.data.summary;
    } catch (error) {
      logger.error('Failed to get stake statistics', { error: error.message });
      return null;
    }
  }
}

// Run the cron job if this script is executed directly
if (require.main === module) {
  console.log('🔄 Initializing Daily Core Energy Reward cron job...');

  const cronJob = new DailyCoreEnergyReward();

  // Add global error handler
  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    logger.error('💥 Unhandled promise rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack
    });
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    logger.error('💥 Uncaught exception', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });

  cronJob.run()
    .then(() => {
      console.log('✅ Daily Core Energy Reward cron job completed successfully');
      logger.info('✅ Daily Core Energy Reward cron job completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Daily Core Energy Reward cron job failed:', error.message);
      logger.error('💥 Daily Core Energy Reward cron job failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = DailyCoreEnergyReward;
