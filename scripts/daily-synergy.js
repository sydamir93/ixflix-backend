#!/usr/bin/env node

/**
 * Daily Synergy Flow payout runner
 * Usage: node backend/scripts/daily-synergy.js
 */
require('dotenv').config({ path: '.env' });
const Synergy = require('../src/models/Synergy');
const JobRun = require('../src/models/JobRun');

async function run() {
  try {
    const result = await Synergy.processAllUsers();
    const todayStr = new Date().toISOString().split('T')[0];
    await JobRun.finish('synergy_flow', todayStr, 'success', result);
    console.log(`Synergy Flow processed: ${JSON.stringify(result)}`);
    process.exit(0);
  } catch (err) {
    console.error('Synergy Flow run failed:', err);
    const todayStr = new Date().toISOString().split('T')[0];
    await JobRun.finish('synergy_flow', todayStr, 'failed', { error: err.message });
    process.exit(1);
  }
}

run();

