/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Wallets table (main wallet only for IXFLIX)
    .createTable('wallets', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('wallet_type', 20).notNullable().defaultTo('main'); // main wallet
      table.decimal('balance', 15, 2).notNullable().defaultTo(0);
      table.timestamps(true, true);

      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.unique(['user_id', 'wallet_type']);
      table.index('user_id');
      table.index('wallet_type');
    })

    // Transactions table
    .createTable('transactions', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('wallet_type', 20).notNullable().defaultTo('main');
      table.string('transaction_type', 20).notNullable(); // deposit, withdraw, transfer
      table.string('reference_type', 20).nullable(); // nowpayment, etc.
      table.string('reference_id', 100).nullable(); // external reference ID
      table.decimal('amount', 15, 2).notNullable(); // positive for credit, negative for debit
      table.decimal('fee', 15, 2).notNullable().defaultTo(0);
      table.string('currency', 10).notNullable().defaultTo('USD');
      table.string('status', 20).notNullable().defaultTo('pending'); // pending, completed, failed, cancelled
      table.text('description').nullable();
      table.json('metadata').nullable(); // Additional transaction data
      table.timestamps(true, true);

      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.index('user_id');
      table.index('wallet_type');
      table.index('transaction_type');
      table.index('status');
      table.index('reference_type');
      table.index('reference_id');
      table.index('created_at');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('transactions')
    .dropTableIfExists('wallets');
};
