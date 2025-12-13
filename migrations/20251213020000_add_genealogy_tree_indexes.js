/**
 * Add composite indexes to speed up:
 * - Placement checks (genealogy parent_id + position)
 * - Tree reads (genealogy sponsor_id + created_at, parent_id + position + created_at)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('genealogy')) {
    const idx1 = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_parent_id_position_index'"
    );
    const has1 = idx1[0]?.length > 0;
    if (!has1) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.index(['parent_id', 'position'], 'genealogy_parent_id_position_index');
      });
    }

    const idx2 = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_sponsor_id_created_at_index'"
    );
    const has2 = idx2[0]?.length > 0;
    if (!has2) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.index(['sponsor_id', 'created_at'], 'genealogy_sponsor_id_created_at_index');
      });
    }

    const idx3 = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_parent_id_position_created_at_index'"
    );
    const has3 = idx3[0]?.length > 0;
    if (!has3) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.index(['parent_id', 'position', 'created_at'], 'genealogy_parent_id_position_created_at_index');
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
    const idx1 = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_parent_id_position_index'"
    );
    const has1 = idx1[0]?.length > 0;
    if (has1) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.dropIndex(['parent_id', 'position'], 'genealogy_parent_id_position_index');
      });
    }

    const idx2 = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_sponsor_id_created_at_index'"
    );
    const has2 = idx2[0]?.length > 0;
    if (has2) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.dropIndex(['sponsor_id', 'created_at'], 'genealogy_sponsor_id_created_at_index');
      });
    }

    const idx3 = await knex.raw(
      "SHOW INDEX FROM `genealogy` WHERE Key_name = 'genealogy_parent_id_position_created_at_index'"
    );
    const has3 = idx3[0]?.length > 0;
    if (has3) {
      await knex.schema.alterTable('genealogy', (table) => {
        table.dropIndex(['parent_id', 'position', 'created_at'], 'genealogy_parent_id_position_created_at_index');
      });
    }
  }
};

