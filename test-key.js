require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testKeys() {
  console.log('Testing with SUPABASE_SERVICE_ROLE_KEY (currently: ' + process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 15) + ')...');
  const client1 = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: d1, error: e1 } = await client1.from('profiles').select('id, role').limit(1);
  console.log('Client 1 result:', { data: d1, error: e1?.message });

  console.log('\nTesting with SUPABASE_SECRET_KEY (currently: ' + process.env.SUPABASE_SECRET_KEY?.slice(0, 15) + ')...');
  const client2 = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { data: d2, error: e2 } = await client2.from('profiles').select('id, role').limit(1);
  console.log('Client 2 result:', { data: d2, error: e2?.message });
}

testKeys();
