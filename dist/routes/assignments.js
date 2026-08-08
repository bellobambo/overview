"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const auth_1 = require("../middleware/auth");
const apiResponse_1 = require("../utils/apiResponse");
const router = express_1.default.Router();
router.get('/', async (req, res) => {
    const role = req.user?.user_metadata?.role;
    const userId = req.user?.id;
    if (!userId) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication required. Please sign in again to continue.');
    }
    if (role === 'teacher') {
        const { data, error } = await supabaseClient_1.default
            .from('assignments')
            .select('*')
            .eq('teacher_id', userId)
            .returns();
        if (error) {
            return (0, apiResponse_1.sendError)(res, 500, 'Unable to load assignments right now. Please try again later.', undefined, error.message);
        }
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Assignments retrieved successfully.', { assignments: data });
    }
    const { data: memberData, error: memberError } = await supabaseClient_1.default
        .from('class_members')
        .select('class_id')
        .eq('user_id', userId)
        .returns();
    if (memberError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load your class assignments right now.', undefined, memberError.message);
    }
    const classIds = (memberData ?? []).map((item) => item.class_id);
    const { data, error } = await supabaseClient_1.default
        .from('assignments')
        .select('*')
        .in('class_id', classIds)
        .returns();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load assignments right now. Please try again later.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Assignments retrieved successfully.', { assignments: data });
});
router.post('/', auth_1.requireTeacher, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['class_id', 'title', 'description', 'due_date']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required assignment details.', { missingFields }, 'Validation failed');
    }
    const { class_id, title, description, due_date, word_limit, ai_policy } = req.body;
    const normalizedAiPolicy = typeof ai_policy === 'string' ? ai_policy.toLowerCase() : ai_policy;
    const { data, error } = await supabaseClient_1.default
        .from('assignments')
        .insert([{ class_id, title, description, due_date, word_limit: word_limit ?? null, ai_policy: normalizedAiPolicy ?? null, teacher_id: req.user?.id }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'The assignment could not be created. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Assignment created successfully.', { assignment: data });
});
exports.default = router;
