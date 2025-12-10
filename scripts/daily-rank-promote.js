#!/usr/bin/env node

/**
 * Daily rank promotion runner
 * - Evaluates all users and updates their rank/override_percent based on directs, pack amount, team volume.
 * - Uses the existing Rank model's autoPromoteAll helper.
 *
 * Usage:
 *   node scripts/daily-rank-promote.js
 *
 * Suggested cron (midnight):
 *   0 0 * * * cd /path/to/backend && node scripts/daily-rank-promote.js >> /var/log/ixflix-rank.log 2>&1
 */

require('dotenv').config({ path: '.env' });
const { autoPromoteAll } = require('../src/models/Rank');
const JobRun = require('../src/models/JobRun');

async function run() {
  const todayStr = new Date().toISOString().split('T')[0];
  try {
    // Optional: mark start (not strictly needed, but keeps parity with other jobs)
    await JobRun.start?.('rank_promote', todayStr, { note: 'Auto-promote ranks' });

    const result = await autoPromoteAll();
    await JobRun.finish?.('rank_promote', todayStr, 'success', result);
    console.log(`Rank promotion completed: ${JSON.stringify(result)}`);
    process.exit(0);
  } catch (err) {
    console.error('Rank promotion failed:', err);
    await JobRun.finish?.('rank_promote', todayStr, 'failed', { error: err.message });
    process.exit(1);
  }
}

run();


