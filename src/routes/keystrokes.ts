import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { KeystrokeLog, CreateKeystrokeLogBody } from '../types/database';

import { requireStudent } from '../middleware/auth';

const router = express.Router();

router.post('/', requireStudent, async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['submission_id', 'events']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required keystroke data.', { missingFields }, 'Validation failed');
    }

    const { submission_id, events } = req.body as CreateKeystrokeLogBody;
    if (!Array.isArray(events)) {
        return sendError(res, 400, 'The events field must be an array of keystroke events.', undefined, 'Validation failed');
    }

    const { data: subData, error: subError } = await supabase
        .from('submissions')
        .select('student_id')
        .eq('id', submission_id)
        .single();

    if (subError || !subData) {
        return sendError(res, 404, 'Submission not found.');
    }

    if (subData.student_id !== req.user?.id) {
        return sendError(res, 403, 'Access denied. You can only log keystrokes for your own submissions.');
    }

    const chunk_seq = req.body.chunk_seq || 0;
    const server_received_at = new Date().toISOString();

    const normalizedEvents = events.map((event: any) => ({
        ...event,
        ...(typeof event.type === 'string' ? { type: event.type.toLowerCase() } : {}),
        chunk_seq,
        server_received_at
    }));

    const { data, error } = await supabase
        .from('keystroke_logs')
        .insert([{ submission_id, events: normalizedEvents }])
        .select()
        .single<KeystrokeLog>();

    if (error) {
        return sendError(res, 500, 'Your keystroke log could not be saved. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Keystroke log saved successfully.', { keystroke_log: data });
});

router.get('/:submissionId', async (req: Request, res: Response) => {
    const submissionId: string = req.params.submissionId;

    const { data: subData, error: subError } = await supabase
        .from('submissions')
        .select('student_id, assignment_id')
        .eq('id', submissionId)
        .single();

    if (subError || !subData) {
        return sendError(res, 404, 'Submission not found.');
    }

    if (subData.student_id !== req.user?.id) {
        if (req.user?.user_metadata?.role === 'teacher') {
            const { data: assignmentData } = await supabase
                .from('assignments')
                .select('teacher_id')
                .eq('id', subData.assignment_id)
                .single();
            
            if (!assignmentData || assignmentData.teacher_id !== req.user?.id) {
                return sendError(res, 403, 'Access denied. You can only view keystrokes for your own assignments.');
            }
        } else {
            return sendError(res, 403, 'Access denied. You can only view keystrokes for your own submissions.');
        }
    }

    const { data, error } = await supabase
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: true })
        .returns<KeystrokeLog[]>();

    if (error) {
        return sendError(res, 500, 'Unable to load keystroke logs for this submission.', undefined, error.message);
    }

    // Flatten and sort the events by chunk_seq then timestamp
    const flattenedEvents = data.flatMap(log => log.events || []);
    
    // Simple deduplication based on exact same timestamp and chunk_seq (idempotency)
    const uniqueEventsMap = new Map();
    for (const ev of flattenedEvents) {
        const key = `${(ev as any).chunk_seq || 0}_${(ev as any).timestamp}`;
        // If a duplicate payload was sent, they will have same chunk_seq and timestamp
        // we can safely overwrite it.
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

    return sendSuccess(res, 200, 'Keystroke logs retrieved successfully.', { logs: uniqueEvents });
});

export default router;
