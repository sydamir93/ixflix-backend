const bcrypt = require('bcryptjs');

exports.seed = async function(knex) {
  // Delete existing entries (if any) for the admin user
  await knex('genealogy').where('user_id', function() {
    this.select('id').from('users').where('role', 'admin');
  }).del();

  await knex('wallets').where('user_id', function() {
    this.select('id').from('users').where('role', 'admin');
  }).del();

  await knex('users').where('role', 'admin').del();

  // Hash the password
  const hashedPassword = await bcrypt.hash('Amirhensem9!', 10);

  // Generate a unique referral code for the admin
  const timestamp = Date.now().toString().slice(-6);
  const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const referralCode = 'IX-' + timestamp + randomNum;

  // Insert admin user
  const [userId] = await knex('users').insert({
    phone_number: '+60162167517', // Placeholder phone number
    password: hashedPassword,
    email: 'admin@ixflix.com',
    name: 'IXFLIX Admin',
    role: 'admin',
    referral_code: referralCode,
    is_active: true,
    is_verified: true,
    email_verified_at: knex.fn.now(),
    phone_verified_at: knex.fn.now(),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  }).returning('id');

  // Create genealogy record (admin is a root user)
  await knex('genealogy').insert({
    user_id: userId,
    parent_id: null, // Root user
    sponsor_id: null, // No sponsor to avoid self-references
    position: null, // Root user
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });

  // Create wallet for admin
  await knex('wallets').insert({
    user_id: userId,
    balance: 0,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });

  console.log('Admin user created successfully!');
  console.log('Email: admin@ixflix.com');
  console.log('Password: Amirhensem9!');
  console.log('Referral Code:', referralCode);
};
