exports.seed = async function(knex) {
  // Ensure at least default spark rank rows exist for all users
  const users = await knex('users').select('id');
  for (const u of users) {
    const existing = await knex('user_ranks').where({ user_id: u.id }).first();
    if (!existing) {
      await knex('user_ranks').insert({
        user_id: u.id,
        rank: 'unranked',
        override_percent: 0,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }
};

