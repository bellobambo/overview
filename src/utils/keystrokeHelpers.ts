import supabase from '../supabaseClient';
import { KeystrokeLog } from '../types/database';

export async function fetchAndFlattenKeystrokes(submissionId: string) {
    const { data, error } = await supabase
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submissionId)
        .order('chunk_seq', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .returns<KeystrokeLog[]>();

    if (error) {
        throw new Error(error.message);
    }

    if (!data) return [];

    const flattenedEvents: Record<string, any>[] = data.flatMap((log, logIndex) =>
        (log.events || []).map((event, eventIndex) => ({
            ...event,
            chunk_seq: (event as any).chunk_seq ?? log.chunk_seq ?? logIndex,
            event_index: (event as any).event_index ?? eventIndex,
            server_received_at: (event as any).server_received_at ?? log.server_received_at ?? log.created_at
        }))
    );

    flattenedEvents.sort((a, b) => {
        const seqA = (a.chunk_seq as number) || 0;
        const seqB = (b.chunk_seq as number) || 0;
        if (seqA !== seqB) return seqA - seqB;
        const indexA = (a.event_index as number) || 0;
        const indexB = (b.event_index as number) || 0;
        if (indexA !== indexB) return indexA - indexB;
        return ((a.timestamp as number) || 0) - ((b.timestamp as number) || 0);
    });

    return flattenedEvents;
}
