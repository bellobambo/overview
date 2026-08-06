"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const apiResponse_1 = require("../utils/apiResponse");
const router = express_1.default.Router();
router.post('/', async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['submission_id', 'events']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required keystroke data.', { missingFields }, 'Validation failed');
    }
    const { submission_id, events } = req.body;
    if (!Array.isArray(events)) {
        return (0, apiResponse_1.sendError)(res, 400, 'The events field must be an array of keystroke events.', undefined, 'Validation failed');
    }
    const { data, error } = await supabaseClient_1.default
        .from('keystroke_logs')
        .insert([{ submission_id, events }])
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your keystroke log could not be saved. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Keystroke log saved successfully.', { keystroke_log: data });
});
router.get('/:submissionId', async (req, res) => {
    const submissionId = req.params.submissionId;
    const { data, error } = await supabaseClient_1.default
        .from('keystroke_logs')
        .select('*')
        .eq('submission_id', submissionId);
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load keystroke logs for this submission.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Keystroke logs retrieved successfully.', { logs: data });
});
exports.default = router;
