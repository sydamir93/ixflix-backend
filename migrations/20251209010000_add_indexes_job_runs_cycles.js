exports.up = async function(knex) {
  if (await knex.schema.hasTable('job_runs')) {
    const jobIdx = await knex.raw(
      "SHOW INDEX FROM `job_runs` WHERE Key_name = 'job_runs_job_name_run_date_index'"
    );
    const hasJobIdx = jobIdx[0]?.length > 0;
    if (!hasJobIdx) {
      await knex.schema.alterTable('job_runs', (table) => {
        table.index(['job_name', 'run_date']);
      });
    }
  }

  if (await knex.schema.hasTable('team_cycles')) {
    const cycIdx = await knex.raw(
      "SHOW INDEX FROM `team_cycles` WHERE Key_name = 'team_cycles_user_id_cycle_date_index'"
    );
    const hasCycIdx = cycIdx[0]?.length > 0;
    if (!hasCycIdx) {
      await knex.schema.alterTable('team_cycles', (table) => {
        table.index(['user_id', 'cycle_date']);
      });
    }
  }
};

exports.down = async function(knex) {
  if (await knex.schema.hasTable('job_runs')) {
    const jobIdx = await knex.raw(
      "SHOW INDEX FROM `job_runs` WHERE Key_name = 'job_runs_job_name_run_date_index'"
    );
    const hasJobIdx = jobIdx[0]?.length > 0;
    if (hasJobIdx) {
      await knex.schema.alterTable('job_runs', (table) => {
        table.dropIndex(['job_name', 'run_date']);
      });
    }
  }

  // For MySQL, dropping the team_cycles index can conflict with FK constraints.
  // Safest rollback: leave the index in place to avoid FK issues.
};

