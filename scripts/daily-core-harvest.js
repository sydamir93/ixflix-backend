#!/usr/bin/env node

/**
 * Daily Core + Harvest reward runner (idempotent via job_runs)
 * Usage: node backend/scripts/daily-core-harvest.js
 */
require('dotenv').config({ path: '.env' });
const Stake = require('../src/models/Stake');
const JobRun = require('../src/models/JobRun');

async function run() {
  try {
    const result = await Stake.runDailyCoreHarvest();
    const todayStr = new Date().toISOString().split('T')[0];
    await JobRun.finish('core_harvest', todayStr, 'success', result);
    console.log(`Core/Harvest processed: ${JSON.stringify(result)}`);
    process.exit(0);
  } catch (err) {
    console.error('Core/Harvest run failed:', err);
    const todayStr = new Date().toISOString().split('T')[0];
    await JobRun.finish('core_harvest', todayStr, 'failed', { error: err.message });
    process.exit(1);
  }
}

run();

