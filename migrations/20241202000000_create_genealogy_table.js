/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('genealogy', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.integer('parent_id').unsigned().nullable();
      table.integer('sponsor_id').unsigned().nullable();
      table.string('position', 20).nullable(); // left, right, etc.
      table.timestamps(true, true);

      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.foreign('parent_id').references('id').inTable('users').onDelete('SET NULL');
      table.foreign('sponsor_id').references('id').inTable('users').onDelete('SET NULL');

      table.index('user_id');
      table.index('parent_id');
      table.index('sponsor_id');
      table.index('position');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('genealogy');
};
