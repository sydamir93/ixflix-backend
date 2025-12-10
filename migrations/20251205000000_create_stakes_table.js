/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('stakes', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('pack_type', 20).notNullable(); // spark, pulse, charge, quantum
      table.integer('shares').notNullable(); // number of shares (1 share = $25)
      table.decimal('amount', 15, 2).notNullable(); // total staked amount in USD
      table.decimal('daily_roi_rate', 5, 4).notNullable(); // daily ROI rate (e.g., 0.0030 for 0.3%)
      table.decimal('total_rewards_earned', 15, 2).notNullable().defaultTo(0); // cumulative rewards earned
      table.decimal('max_reward_limit', 15, 2).notNullable(); // maximum reward limit based on pack
      table.string('status', 20).notNullable().defaultTo('active'); // active, completed, cancelled
      table.timestamp('last_reward_calculation').nullable(); // when rewards were last calculated
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.index('user_id');
      table.index('pack_type');
      table.index('status');
      table.index('created_at');
    })

    // Daily rewards tracking table
    .createTable('stake_rewards', (table) => {
      table.increments('id').primary();
      table.integer('stake_id').unsigned().notNullable();
      table.date('reward_date').notNullable(); // date when reward was earned
      table.decimal('core_reward', 15, 2).notNullable().defaultTo(0); // fixed daily ROI reward
      table.decimal('harvest_reward', 15, 2).notNullable().defaultTo(0); // performance-based reward
      table.decimal('total_reward', 15, 2).notNullable(); // core + harvest reward
      table.string('status', 20).notNullable().defaultTo('pending'); // pending, credited, failed
      table.timestamp('credited_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.foreign('stake_id').references('id').inTable('stakes').onDelete('CASCADE');
      table.unique(['stake_id', 'reward_date']); // one reward per stake per day
      table.index('stake_id');
      table.index('reward_date');
      table.index('status');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('stake_rewards')
    .dropTableIfExists('stakes');
};

