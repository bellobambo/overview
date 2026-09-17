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
const router = express_1.default.Router();
router.post('/', auth_1.requireStudent, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['submission_id', 'events']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required keystroke data.', { missingFields }, 'Validation failed');
    }
    const { submission_id, events } = req.body;
    if (!Array.isArray(events)) {
        return (0, apiResponse_1.sendError)(res, 400, 'The events field must be an array of keystroke events.', undefined, 'Validation failed');
    }
    const { data: subData, error: subError } = await supabaseClient_1.default
        .from('submissions')
        .select('student_id')
        .eq('id', submission_id)
        .single();
    if (subError || !subData) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    if (subData.student_id !== req.user?.id) {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only log keystrokes for your own submissions.');
    }
    const chunk_seq = req.body.chunk_seq || 0;
    const server_received_at = new Date().toISOString();
    const normalizedEvents = events.map((event) => ({
        ...event,
        ...(typeof event.type === 'string' ? { type: event.type.toLowerCase() } : {}),
        chunk_seq,
        server_received_at
    }));
    const { data, error } = await supabaseClient_1.default
        .from('keystroke_logs')
        .insert([{ submission_id, events: normalizedEvents }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your keystroke log could not be saved. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Keystroke log saved successfully.', { keystroke_log: data });
});
router.get('/:submissionId', async (req, res) => {
    const submissionId = req.params.submissionId;
    const { data: subData, error: subError } = await supabaseClient_1.default
        .from('submissions')
        .select('student_id, assignment_id')
        .eq('id', submissionId)
        .single();
    if (subError || !subData) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    if (subData.student_id !== req.user?.id) {
        if (req.user?.user_metadata?.role === 'teacher') {
            const { data: assignmentData } = await supabaseClient_1.default
                .from('assignments')
                .select('teacher_id')
                .eq('id', subData.assignment_id)
                .single();
            if (!assignmentData || assignmentData.teacher_id !== req.user?.id) {
                return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only view keystrokes for your own assignments.');
            }
        }
        else {
            return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only view keystrokes for your own submissions.');
        }
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
