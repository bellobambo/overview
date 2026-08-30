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
        .order('created_at', { ascending: true })
        .returns();
    if (error) {
        throw new Error(error.message);
    }
    if (!data)
        return [];
    const flattenedEvents = data.flatMap(log => log.events || []);
    const uniqueEventsMap = new Map();
    for (const ev of flattenedEvents) {
        const key = `${ev.chunk_seq || 0}_${ev.timestamp}`;
        if (!uniqueEventsMap.has(key) || ev.perfDelta) {
            uniqueEventsMap.set(key, ev);
        }
    }
    const uniqueEvents = Array.from(uniqueEventsMap.values());
    uniqueEvents.sort((a, b) => {
        const seqA = a.chunk_seq || 0;
        const seqB = b.chunk_seq || 0;
        if (seqA !== seqB)
            return seqA - seqB;
        return (a.timestamp || 0) - (b.timestamp || 0);
    });
    return uniqueEvents;
}
