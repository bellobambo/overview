require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
    console.log('Fetching submissions...');
    const { data: submissions, error } = await supabase.from('submissions').select('*');
    if (error) {
        console.error('Error:', error);
        return;
    }

    // Group by student + assignment
    const grouped = {};
    for (const sub of submissions) {
        const key = `${sub.assignment_id}-${sub.student_id}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(sub);
    }

    let deletedCount = 0;
    for (const key in grouped) {
        const subs = grouped[key];
        if (subs.length > 1) {
            // Sort by updated_at descending
            subs.sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
            
            // Delete all but the newest one
            const toDelete = subs.slice(1);
            for (const sub of toDelete) {
                console.log(`Deleting duplicate submission ${sub.id}`);
                const { error: delError } = await supabase.from('submissions').delete().eq('id', sub.id);
                if (delError) console.error(delError);
                else deletedCount++;
            }
        }
    }
    
    console.log(`Done! Deleted ${deletedCount} duplicates.`);
}

clean();
