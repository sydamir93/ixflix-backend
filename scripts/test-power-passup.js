#!/usr/bin/env node

/**
 * Test script for Power Pass-Up Bonus implementation
 * This script demonstrates who is entitled to receive power pass up bonuses
 * and how the distribution works
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { distributePowerPassUp, getUserRankPercent, getSponsorChain, RANKS } = require('../src/models/PowerPassUp');
const Rank = require('../src/models/Rank');
const Stake = require('../src/models/Stake');
const db = require('../src/config/database');
const { logger } = require('../src/utils/logger');

async function testPowerPassUpEligibility() {
  console.log('🔬 Testing Power Pass-Up Bonus Implementation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get some users to test with
    const users = await db('users')
      .select('id', 'name', 'email')
      .limit(5);

    if (users.length === 0) {
      console.log('⚠️ No users found. Create some users first to test.\n');
      return;
    }

    console.log('👥 Available users for testing:');
    for (const user of users) {
      console.log(`   - ID ${user.id}: ${user.name || 'No name'} (${user.email})`);
    }
    console.log('');

    // Test rank evaluation for each user
    console.log('📊 Testing user rank eligibility:');
    for (const user of users) {
      console.log(`\n👤 User ${user.id} (${user.name || 'No name'}):`);

      // Get user rank percent
      const rankPercent = await getUserRankPercent(user.id);
      console.log(`   - Current Rank Percent: ${rankPercent}%`);

      // Get detailed rank evaluation
      const evalResult = await Rank.evaluateUserRank(user.id);
      if (evalResult) {
        console.log(`   - Target Rank: ${evalResult.targetRank || 'unranked'}`);
        console.log(`   - Target Percent: ${evalResult.targetPercent || 0}%`);
        console.log(`   - Direct Referrals: ${evalResult.directReferrals || 0}`);
        console.log(`   - Min Pack Value: $${evalResult.minPackValue || 0}`);
        console.log(`   - Team Volume: $${evalResult.teamVolume || 0}`);
      } else {
        console.log('   - No rank evaluation available');
      }

      // Check if user has active stakes
      const activeStakes = await db('stakes').where({ user_id: user.id, status: 'active' });
      console.log(`   - Active Stakes: ${activeStakes.length}`);
    }
    console.log('');

    // Find users with active stakes to test power pass up distribution
    const usersWithStakes = [];
    for (const user of users) {
      const stakes = await db('stakes').where({ user_id: user.id, status: 'active' });
      if (stakes.length > 0) {
        usersWithStakes.push({ ...user, stakes });
      }
    }

    if (usersWithStakes.length === 0) {
      console.log('⚠️ No users with active stakes found. Create some stakes first to test power pass up.\n');
      return;
    }

    console.log('💰 Testing Power Pass-Up Distribution:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test with a user who has sponsors in the chain (User 5 has sponsor chain: 5 <- 2 <- 1)
    const testUser = users.find(u => u.id === 5); // Amani
    if (!testUser) {
      console.log('⚠️ User 5 not found, using first available user with stakes\n');
      testUser = usersWithStakes[0];
    }

    const testStakes = await db('stakes').where({ user_id: testUser.id, status: 'active' });
    const testStake = testStakes[0];

    console.log(`🎯 Testing with User ${testUser.id} (${testUser.name || 'No name'})`);
    console.log(`   - Stake ID: ${testStake.id}`);
    console.log(`   - Pack Type: ${testStake.pack_type}`);
    console.log(`   - Amount: $${testStake.amount}`);
    console.log('');

    // Show the sponsor chain for this user
    const { getSponsorChain } = require('../src/models/PowerPassUp');
    const sponsorChain = await getSponsorChain(testUser.id);
    console.log(`🔗 Sponsor Chain (up to 9 levels):`);
    if (sponsorChain.length > 0) {
      for (let i = 0; i < sponsorChain.length; i++) {
        const sponsor = await db('users').where({ id: sponsorChain[i] }).select('name').first();
        const sponsorName = sponsor?.name || `User ${sponsorChain[i]}`;
        const sponsorRank = await getUserRankPercent(sponsorChain[i]);
        console.log(`   ${i + 1}. ${sponsorName} (Rank: ${sponsorRank}%)`);
      }
    } else {
      console.log(`   - No sponsors in chain`);
    }
    console.log('');

    // Simulate a core reward (normally this would come from daily reward calculation)
    const simulatedCoreReward = 100.00; // $100 core reward for clearer demonstration
    console.log(`💵 Simulating Core Energy Reward: $${simulatedCoreReward}`);
    console.log('');

    // Test power pass up distribution
    console.log('🔄 Testing Power Pass-Up Distribution...');
    const trx = await db.transaction();

    try {
      const result = await distributePowerPassUp({
        originUserId: testUser.id,
        coreAmount: simulatedCoreReward,
        referenceId: `test-${Date.now()}`,
        trx
      });

      console.log('\n📋 Distribution Results:');
      console.log(`   - Total Distributed: $${result.distributed.toFixed(6)}`);
      console.log(`   - Number of Recipients: ${result.allocations.length}`);

      if (result.allocations.length > 0) {
        console.log('\n🎁 Individual Allocations:');
        for (const allocation of result.allocations) {
          const sponsor = await trx('users').where({ id: allocation.sponsorId }).select('name').first();
          const sponsorName = sponsor?.name || `User ${allocation.sponsorId}`;
          console.log(`   - ${sponsorName}: ${allocation.percent}% = $${allocation.amount.toFixed(6)}`);
        }
      } else {
        console.log('   - No allocations made');
        console.log('   - Checking sponsor eligibility...');

        // Check if sponsors are capped
        const RewardCap = require('../src/models/RewardCap');
        for (const sponsorId of sponsorChain) {
          const sponsorPercent = await getUserRankPercent(sponsorId);
          if (sponsorPercent > 0) {
            const sponsor = await trx('users').where({ id: sponsorId }).select('name').first();
            const capInfo = await RewardCap.getCapInfo(sponsorId, trx);
            const sponsorName = sponsor?.name || `User ${sponsorId}`;
            console.log(`     - ${sponsorName} (${sponsorPercent}%): ${capInfo.available > 0 ? 'Eligible' : 'CAPPED'}`);
          }
        }
      }

      console.log('\n✅ Test completed successfully!');
      console.log('💡 This demonstrates how power pass-up works in the system.');

      // Rollback the test transaction
      await trx.rollback();

    } catch (error) {
      await trx.rollback();
      throw error;
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

async function explainEligibility() {
  console.log('\n📖 PDF-Compliant Power Pass-Up Logic Explained:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('🎯 Implementation Overview:');
  console.log('');
  console.log('1. 📊 TRIGGER & DISTRIBUTION:');
  console.log('   - Activated when ANY user earns Core Energy Rewards');
  console.log('   - Origin user keeps their core reward (rank-independent)');
  console.log('   - Upline sponsors receive override bonuses based on rank hierarchy');
  console.log('');
  console.log('2. 🔗 PROCESSING MECHANISM:');
  console.log('   - Works up the sponsor chain (closest to furthest upline)');
  console.log('   - Each sponsor evaluated in order: sponsor₁, sponsor₂, ..., sponsor₉');
  console.log('   - Skip unranked sponsors (rank ≤ 0%)');
  console.log('   - Skip sponsors with rank ≤ previous baseline');
  console.log('');
  console.log('3. 🧮 CALCULATION LOGIC:');
  console.log('   For each sponsor in chain:');
  console.log('   - IF sponsor_rank% ≤ previous_rank%: SKIP (no payment, baseline unchanged)');
  console.log('   - ELSE: override% = sponsor_rank% - previous_rank%');
  console.log('   - earned_amount = (override% / 100) × original_core_amount');
  console.log('   - Apply reward cap, pay if allowed');
  console.log('   - Update previous_rank% = sponsor_rank%');
  console.log('');
  console.log('4. 💰 EXAMPLE CALCULATION:');
  console.log('   Chain: A(5%) ← B(25%) ← C(40%) ← D(15%) ← E(70%)');
  console.log('   Core Reward: $100, Start: previous_rank=0%');
  console.log('');
  console.log('   A (5%): 5% > 0% ✓ → override=5%, earned=(5/100)*100=$5 → prev=5%');
  console.log('   B (25%): 25% > 5% ✓ → override=20%, earned=(20/100)*100=$20 → prev=25%');
  console.log('   C (40%): 40% > 25% ✓ → override=15%, earned=(15/100)*100=$15 → prev=40%');
  console.log('   D (15%): 15% ≤ 40% ✗ → SKIP (no payment, prev stays 40%)');
  console.log('   E (70%): 70% > 40% ✓ → override=30%, earned=(30/100)*100=$30 → prev=70%');
  console.log('   → Total distributed: $70, Any remaining goes to company');
  console.log('');
  console.log('5. 🏆 RANK LADDER:');
  Object.entries(RANKS).forEach(([rank, percent]) => {
    console.log(`   - ${rank.charAt(0).toUpperCase() + rank.slice(1)}: ${percent}% override`);
  });
  console.log('');
  console.log('6. ✅ KEY CHARACTERISTICS:');
  console.log('   - Fixed percentage calculation from original amount');
  console.log('   - Lower ranks can be skipped without affecting higher ranks');
  console.log('   - All eligible sponsors get their calculated overrides');
  console.log('   - Reward caps applied per individual sponsor');
  console.log('   - Unused portions go to company (not redistributed upline)');
  console.log('');
}

// Run test if executed directly
if (require.main === module) {
  testPowerPassUpEligibility()
    .then(() => {
      return simulateCurrentLogic();
    })
    .then(() => {
      return explainEligibility();
    })
    .then(() => {
      console.log('\n✅ Power Pass-Up test script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Power Pass-Up test script failed');
      process.exit(1);
    });
}

// Simulate the PDF-compliant Power Pass-Up logic for demonstration
async function simulateCurrentLogic() {
  console.log('\n🎭 SIMULATION: PDF-Compliant Power Pass-Up Logic');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('Example Chain: Testing3 (0%) ← IXFlix2 (10%) ← IXFlix1 (40%) ← Amani (5%) ← Poket (25%)');
  console.log('Core Reward: $70');
  console.log('');

  const { getSponsorChain, getUserRankPercent } = require('../src/models/PowerPassUp');
  const db = require('../src/config/database');

  // Use actual data from database
  const chain = await getSponsorChain(21); // Testing3
  const originalCoreAmount = 70;
  let previousRankPercent = 0; // PDF-compliant: always start at 0
  let totalDistributed = 0;

  console.log('Step-by-step processing:');
  console.log(`Start: core_amount = $${originalCoreAmount}, previous_rank = ${previousRankPercent}%`);
  console.log('');

  for (let i = 0; i < chain.length; i++) {
    const sponsorId = chain[i];
    const sponsorRankPercent = await getUserRankPercent(sponsorId);
    const user = await db('users').where({ id: sponsorId }).select('name').first();

    console.log(`${i + 1}. ${user?.name} (${sponsorRankPercent}%)`);

    if (sponsorRankPercent <= 0) {
      console.log(`   → Unranked, skipped`);
      continue;
    }

    if (sponsorRankPercent <= previousRankPercent) {
      console.log(`   → Rank ${sponsorRankPercent}% ≤ ${previousRankPercent}%, skipped (baseline unchanged)`);
      continue;
    }

    const overridePercent = sponsorRankPercent - previousRankPercent;
    const earnedAmount = (overridePercent / 100) * originalCoreAmount;

    console.log(`   → override% = ${sponsorRankPercent}% - ${previousRankPercent}% = ${overridePercent}%`);
    console.log(`   → earned = (${overridePercent} / 100) × $${originalCoreAmount} = $${earnedAmount.toFixed(2)}`);

    // Assume no cap for simulation
    const allowed = earnedAmount;
    if (allowed > 0) {
      console.log(`   → ✅ Pays $${allowed.toFixed(2)}`);
      totalDistributed += allowed;
    }

    previousRankPercent = sponsorRankPercent;
    console.log(`   → Updated: previous_rank = ${previousRankPercent}%`);
    console.log('');
  }

  console.log('🎯 FINAL RESULT:');
  console.log(`Total Distributed: $${totalDistributed.toFixed(2)}`);
  console.log(`Distribution Rate: ${((totalDistributed / 70) * 100).toFixed(1)}% of core reward`);
  console.log(`Note: Any undistributed amount goes to company`);
}

module.exports = {
  testPowerPassUpEligibility,
  explainEligibility,
  simulateCurrentLogic
};