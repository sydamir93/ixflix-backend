exports.up = async function(knex) {
  const hasVolumes = await knex.schema.hasTable('team_volumes');
  if (!hasVolumes) {
    await knex.schema.createTable('team_volumes', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().unique()
        .references('id').inTable('users').onDelete('CASCADE');
      table.decimal('left_volume', 14, 2).notNullable().defaultTo(0);
      table.decimal('right_volume', 14, 2).notNullable().defaultTo(0);
      table.decimal('left_carry', 14, 2).notNullable().defaultTo(0);
      table.decimal('right_carry', 14, 2).notNullable().defaultTo(0);
      table.decimal('daily_paid', 14, 2).notNullable().defaultTo(0);
      table.date('last_reset_date').nullable();
      table.timestamps(true, true);
    });
  }

  const hasCycles = await knex.schema.hasTable('team_cycles');
  if (!hasCycles) {
    await knex.schema.createTable('team_cycles', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.date('cycle_date').notNullable();
      table.integer('cycles').notNullable().defaultTo(0);
      table.decimal('left_used', 14, 2).notNullable().defaultTo(0);
      table.decimal('right_used', 14, 2).notNullable().defaultTo(0);
      table.decimal('weaker_leg_volume', 14, 2).notNullable().defaultTo(0);
      table.decimal('reward_amount', 14, 2).notNullable().defaultTo(0);
      table.decimal('rate_used', 6, 4).notNullable().defaultTo(0);
      table.string('pack_type').nullable();
      table.string('status').notNullable().defaultTo('completed');
      table.timestamps(true, true);
      table.index(['user_id', 'cycle_date']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('team_cycles');
  await knex.schema.dropTableIfExists('team_volumes');
};
exports.up = async function(knex) {
  // team_volumes tracks binary volumes and daily paid caps
  const hasTeamVolumes = await knex.schema.hasTable('team_volumes');
  if (!hasTeamVolumes) {
    await knex.schema.createTable('team_volumes', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().unique()
        .references('id').inTable('users').onDelete('CASCADE');
      table.decimal('left_volume', 14, 2).notNullable().defaultTo(0);
      table.decimal('right_volume', 14, 2).notNullable().defaultTo(0);
      table.decimal('left_carry', 14, 2).notNullable().defaultTo(0);
      table.decimal('right_carry', 14, 2).notNullable().defaultTo(0);
      table.decimal('daily_paid', 14, 2).notNullable().defaultTo(0);
      table.date('last_reset_date').nullable();
      table.timestamps(true, true);
    });
  }

  // team_cycles records payouts for Synergy Flow
  const hasTeamCycles = await knex.schema.hasTable('team_cycles');
  if (!hasTeamCycles) {
    await knex.schema.createTable('team_cycles', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.date('cycle_date').notNullable();
      table.integer('cycles').notNullable().defaultTo(0);
      table.decimal('left_used', 14, 2).notNullable().defaultTo(0);
      table.decimal('right_used', 14, 2).notNullable().defaultTo(0);
      table.decimal('weaker_leg_volume', 14, 2).notNullable().defaultTo(0);
      table.decimal('reward_amount', 14, 2).notNullable().defaultTo(0);
      table.decimal('rate_used', 6, 4).notNullable().defaultTo(0);
      table.string('pack_type').nullable();
      table.string('status').notNullable().defaultTo('completed');
      table.timestamps(true, true);
      table.index(['user_id', 'cycle_date']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('team_cycles');
  await knex.schema.dropTableIfExists('team_volumes');
};

