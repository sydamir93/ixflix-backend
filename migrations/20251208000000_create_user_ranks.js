exports.up = async function(knex) {
  const has = await knex.schema.hasTable('user_ranks');
  if (has) return;

  await knex.schema.createTable('user_ranks', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable().unique()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('rank').notNullable(); // spark, pulse, charge, surge, flux, volt, current, magnet, quantum
    table.decimal('override_percent', 5, 2).notNullable(); // 5.00 - 100.00
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_ranks');
};

