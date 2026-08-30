import supabase from '../supabaseClient';
import { KeystrokeLog } from '../types/database';

export async function fetchAndFlattenKeystrokes(submissionId: string) {
    const { data, error } = await supabase
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: true })
        .returns<KeystrokeLog[]>();

    if (error) {
        throw new Error(error.message);
    }

    if (!data) return [];

    const flattenedEvents = data.flatMap(log => log.events || []);
    
    const uniqueEventsMap = new Map();
    for (const ev of flattenedEvents) {
        const key = `${(ev as any).chunk_seq || 0}_${(ev as any).timestamp}`;
        if (!uniqueEventsMap.has(key) || (ev as any).perfDelta) {
           uniqueEventsMap.set(key, ev);
        }
    }
    
    const uniqueEvents = Array.from(uniqueEventsMap.values());
    uniqueEvents.sort((a, b) => {
        const seqA = (a.chunk_seq as number) || 0;
        const seqB = (b.chunk_seq as number) || 0;
        if (seqA !== seqB) return seqA - seqB;
        return ((a.timestamp as number) || 0) - ((b.timestamp as number) || 0);
    });

    return uniqueEvents;
}
