/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Users table
    .createTable('users', (table) => {
      table.increments('id').primary();
      table.string('phone_number', 20).notNullable().unique();
      table.string('password', 255).nullable();
      table.string('email', 255).nullable().unique();
      table.string('name', 255).nullable();
      table.boolean('is_active').defaultTo(true);
      table.boolean('is_verified').defaultTo(false);
      table.timestamp('email_verified_at').nullable();
      table.timestamp('phone_verified_at').nullable();
      table.timestamps(true, true);
      
      table.index('phone_number');
      table.index('email');
    })
    
    // Two-Factor Authentication table
    .createTable('two_factor_auth', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('secret', 255).notNullable();
      table.boolean('is_enabled').defaultTo(false);
      table.timestamp('enabled_at').nullable();
      table.timestamps(true, true);
      
      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.unique('user_id');
    })
    
    // Backup codes table
    .createTable('backup_codes', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('code', 255).notNullable();
      table.boolean('is_used').defaultTo(false);
      table.timestamp('used_at').nullable();
      table.timestamps(true, true);
      
      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.index('user_id');
      table.unique(['user_id', 'code']);
    })
    
    // Login history table
    .createTable('login_history', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('ip_address', 45).nullable();
      table.string('user_agent', 500).nullable();
      table.string('device', 100).nullable();
      table.string('location', 100).nullable();
      table.boolean('is_successful').defaultTo(true);
      table.string('failure_reason', 255).nullable();
      table.timestamp('logged_in_at').defaultTo(knex.fn.now());
      
      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.index('user_id');
      table.index('logged_in_at');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('login_history')
    .dropTableIfExists('backup_codes')
    .dropTableIfExists('two_factor_auth')
    .dropTableIfExists('users');
};

