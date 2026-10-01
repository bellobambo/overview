"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const auth_1 = require("../middleware/auth");
const apiResponse_1 = require("../utils/apiResponse");
const accessControl_1 = require("../utils/accessControl");
const router = express_1.default.Router();
router.get('/', async (req, res) => {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication required. Please sign in again to continue.');
    }
    if (role === 'teacher') {
        const { data: activeClasses, error: classError } = await supabaseClient_1.default
            .from('classes')
            .select('id')
            .eq('teacher_id', userId)
            .eq('is_archived', false);
        if (classError) {
            return (0, apiResponse_1.sendError)(res, 500, 'Unable to load your active classes.', undefined, classError.message);
        }
        const activeClassIds = (activeClasses ?? []).map(item => item.id);
        if (activeClassIds.length === 0) {
            return (0, apiResponse_1.sendSuccess)(res, 200, 'Assignments retrieved successfully.', { assignments: [] });
        }
        const { data, error } = await supabaseClient_1.default
            .from('assignments')
            .select('*')
            .eq('teacher_id', userId)
            .in('class_id', activeClassIds)
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
    const enrolledClassIds = (memberData ?? []).map((item) => item.class_id);
    if (enrolledClassIds.length === 0) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Assignments retrieved successfully.', { assignments: [] });
    }
    const { data: activeClasses, error: activeClassError } = await supabaseClient_1.default
        .from('classes')
        .select('id')
        .in('id', enrolledClassIds)
        .eq('is_archived', false);
    if (activeClassError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load active class assignments.', undefined, activeClassError.message);
    }
    const classIds = (activeClasses ?? []).map(item => item.id);
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
    if (typeof title !== 'string' || title.trim().length > 200 || typeof description !== 'string' || description.length > 10_000) {
        return (0, apiResponse_1.sendError)(res, 400, 'Assignment title or description is invalid.');
    }
    if (Number.isNaN(Date.parse(due_date))) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide a valid due date.');
    }
    if (word_limit != null && (!Number.isInteger(word_limit) || word_limit < 1 || word_limit > 100_000)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Word limit must be a whole number between 1 and 100,000.');
    }
    if (normalizedAiPolicy != null && !['allowed', 'restricted', 'forbidden'].includes(normalizedAiPolicy)) {
        return (0, apiResponse_1.sendError)(res, 400, 'AI policy must be allowed, restricted, or forbidden.');
    }
    try {
        const ownedClass = await (0, accessControl_1.getOwnedClass)(class_id, req.user?.id);
        if (!ownedClass || ownedClass.is_archived) {
            return (0, apiResponse_1.sendError)(res, 404, 'Active class not found or you do not have permission to use it.');
        }
    }
    catch (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to verify class ownership.', undefined, error.message);
    }
    const { data, error } = await supabaseClient_1.default
        .from('assignments')
        .insert([{ class_id, title: title.trim(), description: description.trim(), due_date, word_limit: word_limit ?? null, ai_policy: normalizedAiPolicy ?? null, teacher_id: req.user?.id }])
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
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 200)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Assignment title is invalid.');
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 10_000)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Assignment description is invalid.');
    }
    if (due_date !== undefined && (typeof due_date !== 'string' || Number.isNaN(Date.parse(due_date)))) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide a valid due date.');
    }
    if (word_limit !== undefined && word_limit !== null && (!Number.isInteger(word_limit) || word_limit < 1 || word_limit > 100_000)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Word limit must be a whole number between 1 and 100,000.');
    }
    if (ai_policy !== undefined && ai_policy !== null && (typeof ai_policy !== 'string' || !['allowed', 'restricted', 'forbidden'].includes(ai_policy.toLowerCase()))) {
        return (0, apiResponse_1.sendError)(res, 400, 'AI policy must be allowed, restricted, or forbidden.');
    }
    if (is_archived !== undefined && typeof is_archived !== 'boolean') {
        return (0, apiResponse_1.sendError)(res, 400, 'Archived state must be true or false.');
    }
    // Build the update payload from only the fields that were provided.
    const updates = {};
    if (title !== undefined)
        updates.title = title.trim();
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
