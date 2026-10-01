require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('Checking auth users and profiles...');
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) {
    console.error('User list error:', userError);
  } else {
    console.log(`Found ${users.users.length} auth users:`);
    for (const u of users.users) {
      console.log(`- ${u.id}: email=${u.email}, metadata=${JSON.stringify(u.user_metadata)}`);
    }
  }

  const { data: profiles, error: profError } = await supabase.from('profiles').select('*');
  if (profError) {
    console.error('Profiles query error:', profError);
  } else {
    console.log(`Found ${profiles.length} profiles:`);
    for (const p of profiles) {
      console.log(`- ${p.id}: full_name=${p.full_name}, role=${p.role}`);
    }
  }
}

check();
