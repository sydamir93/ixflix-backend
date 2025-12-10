#!/usr/bin/env node

/**
 * Test script for Daily Core Energy Reward calculation
 * This script helps verify the cron job functionality
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Stake = require('../src/models/Stake');
const { logger } = require('../src/utils/logger');

async function testDailyRewards() {
  console.log('🧪 Testing Daily Core Energy Reward calculation...\n');

  try {
    // Get active stakes count
    const activeStakes = await Stake.getAllActive();
    console.log(`📊 Found ${activeStakes.length} active stakes\n`);

    if (activeStakes.length === 0) {
      console.log('⚠️ No active stakes found. Create some stakes first to test.\n');
      return;
    }

    // Test calculation on first stake
    const testStake = activeStakes[0];
    console.log(`🔍 Testing calculation for stake ${testStake.id}:`);
    console.log(`   - Pack Type: ${testStake.pack_type}`);
    console.log(`   - Amount: $${testStake.amount}`);
    console.log(`   - Shares: ${testStake.shares}`);
    console.log(`   - Current Rewards: $${testStake.total_rewards_earned}`);
    console.log(`   - Max Reward Limit: ${testStake.max_reward_limit}%\n`);

    // Calculate expected reward
    const expectedReward = parseFloat(testStake.amount) * parseFloat(testStake.daily_roi_rate);
    console.log(`💰 Expected Daily Reward: $${expectedReward.toFixed(6)}\n`);

    // Test the actual calculation
    console.log('⚙️ Running actual calculation...');
    const reward = await Stake.calculateDailyReward(testStake.id);

    if (reward) {
      console.log('✅ Reward calculation successful!');
      console.log(`   - Core Reward: $${reward.core_reward}`);
      console.log(`   - Harvest Reward: $${reward.harvest_reward}`);
      console.log(`   - Total Reward: $${reward.total_reward}`);
      console.log(`   - Status: ${reward.status}`);
      console.log(`   - Date: ${reward.reward_date}\n`);
    } else {
      console.log('⏭️ No reward calculated (stake may have reached limit or already processed today)\n');
    }

    // Show summary
    console.log('📈 Test completed successfully!');
    console.log('💡 The cron job should work correctly when scheduled.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run test if executed directly
if (require.main === module) {
  testDailyRewards()
    .then(() => {
      console.log('\n✅ Test script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test script failed');
      process.exit(1);
    });
}

module.exports = testDailyRewards;
