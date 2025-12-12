#!/usr/bin/env node

/**
 * Reset Daily Processes
 * This script allows re-running daily processes for today by removing job run records.
 *
 * Daily Processes:
 * 1. Core Harvest - Calculates daily stake rewards (--clean-rewards to remove existing rewards)
 * 2. Synergy Flow - Processes synergy bonuses and cycles (--reset-synergy to reset synergy jobs)
 * 3. Rank Promotion - Updates user ranks (--reset-ranks to reset rank jobs)
 * 4. Rebuild Volumes - Recalculates team_volumes from genealogy (--rebuild-volumes)
 *
 * Usage:
 *   node backend/scripts/reset-daily.js [--clean-rewards] [--reset-synergy] [--reset-ranks] [--rebuild-volumes] [--all]
 */

require('dotenv').config({ path: '.env' });
const db = require('../src/config/database');
const rebuildTeamVolumes = require('./rebuild-team-volumes');

async function resetDaily() {
  const cleanRewards = process.argv.includes('--clean-rewards') || process.argv.includes('--all');
  const resetSynergy = process.argv.includes('--reset-synergy') || process.argv.includes('--all');
  const resetRanks = process.argv.includes('--reset-ranks') || process.argv.includes('--all');
  const rebuildVolumes = process.argv.includes('--rebuild-volumes') || process.argv.includes('--all');
  const todayStr = new Date().toISOString().split('T')[0];

  console.log(`🔄 Resetting daily processes for ${todayStr}...`);

  try {
    // Rebuild team volumes first if requested
    if (rebuildVolumes) {
      console.log('🏗️ Rebuilding team volumes...');
      await rebuildTeamVolumes();
      console.log('✅ Team volumes rebuilt\n');
    }
    let totalJobsDeleted = 0;

    // Reset Core Harvest (daily stake rewards)
    if (cleanRewards || resetSynergy || resetRanks || rebuildVolumes) {
      const coreJobDeleted = await db('job_runs')
        .where({ job_name: 'core_harvest', run_date: todayStr })
        .del();
      totalJobsDeleted += coreJobDeleted;
      console.log(`✅ Reset core harvest job (${coreJobDeleted} record)`);

      if (cleanRewards) {
        const rewardsDeleted = await db('stake_rewards')
          .where({ reward_date: todayStr })
          .del();
        console.log(`🧹 Removed ${rewardsDeleted} stake reward records for recalculation`);
      }
    }

    // Reset Synergy Flow (synergy bonuses and volume calculations)
    if (resetSynergy) {
      const synergyJobDeleted = await db('job_runs')
        .where({ job_name: 'synergy_flow', run_date: todayStr })
        .del();
      totalJobsDeleted += synergyJobDeleted;
      console.log(`✅ Reset synergy flow job (${synergyJobDeleted} record)`);

      // Optionally clean synergy-related data (transactions, cycles, etc.)
      const synergyTxDeleted = await db('transactions')
        .where({ transaction_type: 'synergy_flow' })
        .whereRaw(`DATE(created_at) = ?`, [todayStr])
        .del();
      console.log(`🧹 Removed ${synergyTxDeleted} synergy flow transactions`);
    }

    // Reset Rank Promotion (rank updates)
    if (resetRanks) {
      const rankJobDeleted = await db('job_runs')
        .where({ job_name: 'rank_promote', run_date: todayStr })
        .del();
      totalJobsDeleted += rankJobDeleted;
      console.log(`✅ Reset rank promotion job (${rankJobDeleted} record)`);
    }

    console.log(`\n🎯 Total job records reset: ${totalJobsDeleted}`);
    console.log(`💻 Available daily scripts:`);
    if (cleanRewards || resetSynergy || resetRanks || rebuildVolumes) {
      console.log(`   • Core Harvest: node backend/scripts/daily-core-harvest.js`);
    }
    if (resetSynergy || rebuildVolumes) {
      console.log(`   • Synergy Flow: node backend/scripts/daily-synergy.js`);
    }
    if (resetRanks) {
      console.log(`   • Rank Promotion: node backend/scripts/daily-rank-promote.js`);
    }

  } catch (error) {
    console.error('❌ Reset failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  resetDaily();
}

module.exports = resetDaily;
