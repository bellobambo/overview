"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const apiResponse_1 = require("../utils/apiResponse");
const auth_1 = require("../middleware/auth");
const keystrokeHelpers_1 = require("../utils/keystrokeHelpers");
const accessControl_1 = require("../utils/accessControl");
const router = express_1.default.Router();
router.post('/', auth_1.requireStudent, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['submission_id', 'events']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required keystroke data.', { missingFields }, 'Validation failed');
    }
    const { submission_id, events, chunk_seq, client_batch_id } = req.body;
    if (!Array.isArray(events) || events.length === 0 || events.length > 2_000) {
        return (0, apiResponse_1.sendError)(res, 400, 'The events field must contain between 1 and 2,000 keystroke events.', undefined, 'Validation failed');
    }
    if (!Number.isInteger(chunk_seq) || chunk_seq < 1) {
        return (0, apiResponse_1.sendError)(res, 400, 'chunk_seq must be a positive integer.', undefined, 'Validation failed');
    }
    if (client_batch_id !== undefined && (typeof client_batch_id !== 'string' || client_batch_id.length > 100)) {
        return (0, apiResponse_1.sendError)(res, 400, 'client_batch_id is invalid.', undefined, 'Validation failed');
    }
    const validTypes = new Set(['step', 'window', 'insert', 'delete', 'paste', 'mark']);
    if (events.some((event) => !event || typeof event !== 'object' || Array.isArray(event)
        || typeof event.type !== 'string' || !validTypes.has(event.type.toLowerCase())
        || !Number.isFinite(event.timestamp)
        || (event.type === 'step' && (!event.stepJSON || typeof event.stepJSON !== 'object'))
        || (event.type === 'window' && !['blur', 'focus'].includes(event.action)))) {
        return (0, apiResponse_1.sendError)(res, 400, 'One or more writing events are invalid.', undefined, 'Validation failed');
    }
    const { data: subData, error: subError } = await supabaseClient_1.default
        .from('submissions')
        .select('student_id, status')
        .eq('id', submission_id)
        .single();
    if (subError || !subData) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    if (subData.student_id !== req.user?.id) {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only log keystrokes for your own submissions.');
    }
    if (!['draft', 'revision_requested'].includes(subData.status)) {
        return (0, apiResponse_1.sendError)(res, 409, 'This submission is locked and cannot accept additional writing events.');
    }
    const server_received_at = new Date().toISOString();
    const normalizedEvents = events.map((event, eventIndex) => ({
        ...event,
        ...(typeof event.type === 'string' ? { type: event.type.toLowerCase() } : {}),
        chunk_seq,
        event_index: eventIndex,
        server_received_at
    }));
    const { data: existingChunk, error: existingError } = await supabaseClient_1.default
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submission_id)
        .eq('chunk_seq', chunk_seq)
        .maybeSingle();
    if (existingError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to verify the writing-event chunk.', undefined, existingError.message);
    }
    if (existingChunk) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Keystroke chunk already received.', { keystroke_log: existingChunk });
    }
    const { data, error } = await supabaseClient_1.default
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
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your keystroke log could not be saved. Please try again.', undefined, error.message);
    }
    await supabaseClient_1.default
        .from('submissions')
        .update({
        ai_score: null,
        analysis_data: null,
        analysis_revision: null,
        analysis_model_version: null,
        analysis_generated_at: null
    })
        .eq('id', submission_id);
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Keystroke log saved successfully.', { keystroke_log: data });
});
router.get('/:submissionId', async (req, res) => {
    const submissionId = req.params.submissionId;
    try {
        const access = await (0, accessControl_1.getSubmissionAccess)(submissionId, {
            id: req.user?.id,
            role: req.user?.role
        });
        if (!access) {
            return (0, apiResponse_1.sendError)(res, 404, 'Submission not found or you do not have permission to view it.');
        }
    }
    catch (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to verify submission access.', undefined, error.message);
    }
    let uniqueEvents = [];
    try {
        uniqueEvents = await (0, keystrokeHelpers_1.fetchAndFlattenKeystrokes)(submissionId);
    }
    catch (e) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load keystroke logs for this submission.', undefined, e.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Keystroke logs retrieved successfully.', { logs: uniqueEvents });
});
exports.default = router;
