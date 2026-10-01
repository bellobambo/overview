"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAndFlattenKeystrokes = fetchAndFlattenKeystrokes;
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
async function fetchAndFlattenKeystrokes(submissionId) {
    const { data, error } = await supabaseClient_1.default
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submissionId)
        .order('chunk_seq', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .returns();
    if (error) {
        throw new Error(error.message);
    }
    if (!data)
        return [];
    const flattenedEvents = data.flatMap((log, logIndex) => (log.events || []).map((event, eventIndex) => ({
        ...event,
        chunk_seq: event.chunk_seq ?? log.chunk_seq ?? logIndex,
        event_index: event.event_index ?? eventIndex,
        server_received_at: event.server_received_at ?? log.server_received_at ?? log.created_at
    })));
    flattenedEvents.sort((a, b) => {
        const seqA = a.chunk_seq || 0;
        const seqB = b.chunk_seq || 0;
        if (seqA !== seqB)
            return seqA - seqB;
        const indexA = a.event_index || 0;
        const indexB = b.event_index || 0;
        if (indexA !== indexB)
            return indexA - indexB;
        return (a.timestamp || 0) - (b.timestamp || 0);
    });
    return flattenedEvents;
}
