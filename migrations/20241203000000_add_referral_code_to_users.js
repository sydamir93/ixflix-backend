/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('users', (table) => {
      table.string('referral_code', 20).unique().nullable();
      table.index('referral_code');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .alterTable('users', (table) => {
      table.dropIndex('referral_code');
      table.dropColumn('referral_code');
    });
};
