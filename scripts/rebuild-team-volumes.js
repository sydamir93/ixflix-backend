#!/usr/bin/env node

/**
 * Rebuild Team Volumes
 * Recalculates team_volumes table from scratch by:
 * 1. Creating volume rows for all users in genealogy
 * 2. Redistributing volumes from all active stakes up the genealogy tree
 *
 * Usage: node backend/scripts/rebuild-team-volumes.js
 */

require('dotenv').config({ path: '.env' });
const db = require('../src/config/database');
const Synergy = require('../src/models/Synergy');

async function rebuildTeamVolumes() {
  console.log('🔄 Rebuilding team volumes from genealogy and active stakes...\n');

  try {
    // Step 1: Get all unique users from genealogy table
    console.log('📊 Gathering users from genealogy...');
    const genealogyUsers = await db('genealogy')
      .distinct('user_id')
      .union(function() {
        this.distinct('parent_id').from('genealogy').whereNotNull('parent_id');
      });

    console.log(`✅ Found ${genealogyUsers.length} users in genealogy`);

    // Step 2: Create volume rows for all users (this will skip existing ones)
    console.log('🏗️ Creating volume rows...');
    let volumeRowsCreated = 0;
    for (const user of genealogyUsers) {
      await Synergy.ensureVolumeRow(user.user_id || user.parent_id);
      volumeRowsCreated++;
    }
    console.log(`✅ Created/ensured ${volumeRowsCreated} volume rows`);

    // Step 3: Reset all volumes to zero (fresh start)
    console.log('🔄 Resetting all volumes to zero...');
    await db('team_volumes').update({
      left_volume: 0,
      right_volume: 0,
      left_carry: 0,
      right_carry: 0,
      daily_paid: 0,
      last_reset_date: null,
      updated_at: db.fn.now()
    });
    console.log('✅ All volumes reset to zero');

    // Step 4: Get all active stakes
    console.log('📊 Gathering active stakes...');
    const activeStakes = await db('stakes')
      .where({ status: 'active' })
      .select('id', 'user_id', 'amount');

    console.log(`✅ Found ${activeStakes.length} active stakes`);

    // Step 5: Redistribute volumes from each stake
    console.log('🔄 Redistributing volumes up genealogy tree...');
    let processedStakes = 0;
    let totalVolumeDistributed = 0;

    for (const stake of activeStakes) {
      const stakeAmount = parseFloat(stake.amount);
      await Synergy.addVolumeToUplines(stake.user_id, stakeAmount);
      processedStakes++;
      totalVolumeDistributed += stakeAmount;

      if (processedStakes % 100 === 0) {
        console.log(`   Processed ${processedStakes}/${activeStakes.length} stakes...`);
      }
    }

    console.log(`✅ Processed ${processedStakes} stakes`);
    console.log(`💰 Total volume distributed: $${totalVolumeDistributed.toFixed(2)}`);

    // Step 6: Verify results
    console.log('\n📈 Volume distribution summary:');
    const volumeStats = await db('team_volumes')
      .select(
        db.raw('COUNT(*) as total_users'),
        db.raw('SUM(left_volume) as total_left_volume'),
        db.raw('SUM(right_volume) as total_right_volume')
      )
      .first();

    console.log(`   Users with volumes: ${volumeStats.total_users}`);
    console.log(`   Total left volume: $${parseFloat(volumeStats.total_left_volume || 0).toFixed(2)}`);
    console.log(`   Total right volume: $${parseFloat(volumeStats.total_right_volume || 0).toFixed(2)}`);

    console.log('\n🎯 Team volumes rebuild completed successfully!');
    console.log('💻 You can now run the daily synergy script:');
    console.log('   node backend/scripts/daily-synergy.js');

  } catch (error) {
    console.error('❌ Rebuild failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  rebuildTeamVolumes();
}

module.exports = rebuildTeamVolumes;
