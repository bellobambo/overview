import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { KeystrokeLog, CreateKeystrokeLogBody } from '../types/database';

import { requireStudent } from '../middleware/auth';
import { fetchAndFlattenKeystrokes } from '../utils/keystrokeHelpers';
import { getSubmissionAccess } from '../utils/accessControl';

const router = express.Router();

router.post('/', requireStudent, async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['submission_id', 'events']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required keystroke data.', { missingFields }, 'Validation failed');
    }

    const { submission_id, events, chunk_seq, client_batch_id } = req.body as CreateKeystrokeLogBody;
    if (!Array.isArray(events) || events.length === 0 || events.length > 2_000) {
        return sendError(res, 400, 'The events field must contain between 1 and 2,000 keystroke events.', undefined, 'Validation failed');
    }
    if (!Number.isInteger(chunk_seq) || chunk_seq < 1) {
        return sendError(res, 400, 'chunk_seq must be a positive integer.', undefined, 'Validation failed');
    }
    if (client_batch_id !== undefined && (typeof client_batch_id !== 'string' || client_batch_id.length > 100)) {
        return sendError(res, 400, 'client_batch_id is invalid.', undefined, 'Validation failed');
    }
    const validTypes = new Set(['step', 'window', 'insert', 'delete', 'paste', 'mark']);
    if (events.some((event: any) => !event || typeof event !== 'object' || Array.isArray(event)
        || typeof event.type !== 'string' || !validTypes.has(event.type.toLowerCase())
        || !Number.isFinite(event.timestamp)
        || (event.type === 'step' && (!event.stepJSON || typeof event.stepJSON !== 'object'))
        || (event.type === 'window' && !['blur', 'focus'].includes(event.action)))) {
        return sendError(res, 400, 'One or more writing events are invalid.', undefined, 'Validation failed');
    }

    const { data: subData, error: subError } = await supabase
        .from('submissions')
        .select('student_id, status')
        .eq('id', submission_id)
        .single();

    if (subError || !subData) {
        return sendError(res, 404, 'Submission not found.');
    }

    if (subData.student_id !== req.user?.id) {
        return sendError(res, 403, 'Access denied. You can only log keystrokes for your own submissions.');
    }

    if (!['draft', 'revision_requested'].includes(subData.status)) {
        return sendError(res, 409, 'This submission is locked and cannot accept additional writing events.');
    }

    const server_received_at = new Date().toISOString();

    const normalizedEvents = events.map((event: any, eventIndex: number) => ({
        ...event,
        ...(typeof event.type === 'string' ? { type: event.type.toLowerCase() } : {}),
        chunk_seq,
        event_index: eventIndex,
        server_received_at
    }));

    const { data: existingChunk, error: existingError } = await supabase
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submission_id)
        .eq('chunk_seq', chunk_seq)
        .maybeSingle<KeystrokeLog>();

    if (existingError) {
        return sendError(res, 500, 'Unable to verify the writing-event chunk.', undefined, existingError.message);
    }
    if (existingChunk) {
        return sendSuccess(res, 200, 'Keystroke chunk already received.', { keystroke_log: existingChunk });
    }

    const { data, error } = await supabase
        .from('keystroke_logs')
        .insert([{
            submission_id,
            events: normalizedEvents,
            chunk_seq,
            client_batch_id: client_batch_id ?? null,
            event_count: normalizedEvents.length,
            server_received_at
        }])
        .select()
        .single<KeystrokeLog>();

    if (error) {
        return sendError(res, 500, 'Your keystroke log could not be saved. Please try again.', undefined, error.message);
    }


    await supabase
        .from('submissions')
        .update({
            ai_score: null,
            analysis_data: null,
            analysis_revision: null,
            analysis_model_version: null,
            analysis_generated_at: null
        })
        .eq('id', submission_id);

    return sendSuccess(res, 201, 'Keystroke log saved successfully.', { keystroke_log: data });
});

router.get('/:submissionId', async (req: Request, res: Response) => {
    const submissionId: string = req.params.submissionId;

    try {
        const access = await getSubmissionAccess(submissionId, {
            id: req.user?.id as string,
            role: req.user?.role
        });
        if (!access) {
            return sendError(res, 404, 'Submission not found or you do not have permission to view it.');
        }
    } catch (error: any) {
        return sendError(res, 500, 'Unable to verify submission access.', undefined, error.message);
    }

    let uniqueEvents = [];
    try {
        uniqueEvents = await fetchAndFlattenKeystrokes(submissionId);
    } catch (e: any) {
        return sendError(res, 500, 'Unable to load keystroke logs for this submission.', undefined, e.message);
    }

    return sendSuccess(res, 200, 'Keystroke logs retrieved successfully.', { logs: uniqueEvents });
});

export default router;
