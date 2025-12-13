/**
 * Add composite indexes to speed up:
 * - Recursive downline traversal (genealogy sponsor_id -> user_id)
 * - Pending reward lookups (stake_rewards by stake_id + status)
 * - Active stake filtering (stakes by user_id + status)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('genealogy')) {
    const idx = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_sponsor_id_user_id_index'"
    );
    const has = idx[0]?.length > 0;
    if (!has) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.index(['sponsor_id', 'user_id'], 'genealogy_sponsor_id_user_id_index');
      });
    }
  }

  if (await knex.schema.hasTable('stakes')) {
    const idx = await knex.raw(
      "SHOW INDEX FROM `stakes` WHERE Key_name = 'stakes_user_id_status_index'"
    );
    const has = idx[0]?.length > 0;
    if (!has) {
      await knex.schema.alterTable('stakes', (table) => {
        table.index(['user_id', 'status'], 'stakes_user_id_status_index');
      });
    }
  }

  if (await knex.schema.hasTable('stake_rewards')) {
    const idx = await knex.raw(
      "SHOW INDEX FROM `stake_rewards` WHERE Key_name = 'stake_rewards_stake_id_status_index'"
    );
    const has = idx[0]?.length > 0;
    if (!has) {
      await knex.schema.alterTable('stake_rewards', (table) => {
        table.index(['stake_id', 'status'], 'stake_rewards_stake_id_status_index');
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  if (await knex.schema.hasTable('genealogy')) {
    const idx = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_sponsor_id_user_id_index'"
    );
    const has = idx[0]?.length > 0;
    if (has) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.dropIndex(['sponsor_id', 'user_id'], 'genealogy_sponsor_id_user_id_index');
      });
    }
  }

  if (await knex.schema.hasTable('stakes')) {
    const idx = await knex.raw(
      "SHOW INDEX FROM `stakes` WHERE Key_name = 'stakes_user_id_status_index'"
    );
    const has = idx[0]?.length > 0;
    if (has) {
      await knex.schema.alterTable('stakes', (table) => {
        table.dropIndex(['user_id', 'status'], 'stakes_user_id_status_index');
      });
    }
  }

  if (await knex.schema.hasTable('stake_rewards')) {
    const idx = await knex.raw(
      "SHOW INDEX FROM `stake_rewards` WHERE Key_name = 'stake_rewards_stake_id_status_index'"
    );
    const has = idx[0]?.length > 0;
    if (has) {
      await knex.schema.alterTable('stake_rewards', (table) => {
        table.dropIndex(['stake_id', 'status'], 'stake_rewards_stake_id_status_index');
      });
    }
  }
};

