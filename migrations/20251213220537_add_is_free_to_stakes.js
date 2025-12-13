/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('stakes', (table) => {
    table.boolean('is_free').notNullable().defaultTo(false).after('shares');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('stakes', (table) => {
    table.dropColumn('is_free');
  });
};
