exports.up = async function(knex) {
  const has = await knex.schema.hasTable('job_runs');
  if (has) return;
  await knex.schema.createTable('job_runs', (table) => {
    table.increments('id').primary();
    table.string('job_name').notNullable();
    table.date('run_date').notNullable();
    table.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('finished_at').nullable();
    table.string('status').notNullable().defaultTo('running'); // running | success | failed
    table.json('meta').nullable();
    table.unique(['job_name', 'run_date']);
    table.index(['job_name', 'run_date']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('job_runs');
};

