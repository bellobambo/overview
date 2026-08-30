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
            .eq('is_archived', false)
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
    if (classIds.length === 0) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Assignments retrieved successfully.', { assignments: [] });
    }
    const { data, error } = await supabaseClient_1.default
        .from('assignments')
        .select('*')
        .in('class_id', classIds)
        .eq('is_archived', false)
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
// PATCH /assignments/:id — lets a teacher edit or archive one of their own assignments.
// Accepts: title, description, due_date, word_limit, ai_policy, is_archived.
// Verifies teacher ownership before applying updates.
router.patch('/:id', auth_1.requireTeacher, async (req, res) => {
    const { id } = req.params;
    const teacherId = req.user?.id;
    const { title, description, due_date, word_limit, ai_policy, is_archived } = req.body;
    // Ensure at least one updatable field was provided.
    if (title === undefined &&
        description === undefined &&
        due_date === undefined &&
        word_limit === undefined &&
        ai_policy === undefined &&
        is_archived === undefined) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide at least one field to update.', undefined, 'Validation failed');
    }
    // Verify the teacher owns this assignment before allowing any changes.
    const { data: existing, error: fetchError } = await supabaseClient_1.default
        .from('assignments')
        .select('id')
        .eq('id', id)
        .eq('teacher_id', teacherId)
        .maybeSingle();
    if (fetchError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to verify assignment ownership right now. Please try again.', undefined, fetchError.message);
    }
    if (!existing) {
        return (0, apiResponse_1.sendError)(res, 404, 'Assignment not found or you do not have permission to update it.');
    }
    // Build the update payload from only the fields that were provided.
    const updates = {};
    if (title !== undefined)
        updates.title = title;
    if (description !== undefined)
        updates.description = description;
    if (due_date !== undefined)
        updates.due_date = due_date;
    if (word_limit !== undefined)
        updates.word_limit = word_limit;
    if (ai_policy !== undefined)
        updates.ai_policy = typeof ai_policy === 'string' ? ai_policy.toLowerCase() : ai_policy;
    if (is_archived !== undefined)
        updates.is_archived = is_archived;
    const { data, error } = await supabaseClient_1.default
        .from('assignments')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to update the assignment right now. Please try again.', undefined, error.message);
    }
    const message = is_archived === true
        ? 'Assignment archived successfully.'
        : is_archived === false
            ? 'Assignment restored successfully.'
            : 'Assignment updated successfully.';
    return (0, apiResponse_1.sendSuccess)(res, 200, message, { assignment: data });
});
exports.default = router;
