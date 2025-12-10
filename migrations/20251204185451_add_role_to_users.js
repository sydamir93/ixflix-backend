/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('users', (table) => {
      table.enum('role', ['user', 'admin']).notNullable().defaultTo('user');
      table.index('role');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .alterTable('users', (table) => {
      table.dropIndex('role');
      table.dropColumn('role');
    });
};
