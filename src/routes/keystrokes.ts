import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { KeystrokeLog, CreateKeystrokeLogBody } from '../types/database';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['submission_id', 'events']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required keystroke data.', { missingFields }, 'Validation failed');
    }

    const { submission_id, events } = req.body as CreateKeystrokeLogBody;
    if (!Array.isArray(events)) {
        return sendError(res, 400, 'The events field must be an array of keystroke events.', undefined, 'Validation failed');
    }

    const { data, error } = await supabase
        .from('keystroke_logs')
        .insert([{ submission_id, events }])
        .select()
        .single<KeystrokeLog>();

    if (error) {
        return sendError(res, 500, 'Your keystroke log could not be saved. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Keystroke log saved successfully.', { keystroke_log: data });
});

router.get('/:submissionId', async (req: Request, res: Response) => {
    const submissionId: string = req.params.submissionId;
    const { data, error } = await supabase
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submissionId)
        .returns<KeystrokeLog[]>();

    if (error) {
        return sendError(res, 500, 'Unable to load keystroke logs for this submission.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Keystroke logs retrieved successfully.', { logs: data });
});

export default router;
