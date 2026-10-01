"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const auth_1 = require("../middleware/auth");
const apiResponse_1 = require("../utils/apiResponse");
const crypto_1 = require("crypto");
const rateLimit_1 = require("../middleware/rateLimit");
const router = express_1.default.Router();
router.get('/members', auth_1.requireTeacher, async (req, res) => {
    const { data: ownedClasses, error: classError } = await supabaseClient_1.default
        .from('classes')
        .select('id')
        .eq('teacher_id', req.user?.id)
        .eq('is_archived', false);
    if (classError)
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load class rosters.', undefined, classError.message);
    const classIds = (ownedClasses ?? []).map(item => item.id);
    if (classIds.length === 0)
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Class rosters retrieved.', { members: [] });
    const { data, error } = await supabaseClient_1.default
        .from('class_members')
        .select('user_id, class_id, joined_at, profiles!user_id(id, full_name)')
        .in('class_id', classIds);
    if (error)
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load class rosters.', undefined, error.message);
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Class rosters retrieved.', { members: data ?? [] });
});
/** Generates a random 8-character uppercase alphanumeric join code. */
function generateJoinCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => alphabet[(0, crypto_1.randomInt)(0, alphabet.length)]).join('');
}
router.get('/', async (req, res) => {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (role === 'teacher') {
        const { data, error } = await supabaseClient_1.default
            .from('classes')
            .select('*')
            .eq('teacher_id', userId)
            .eq('is_archived', false)
            .returns();
        if (error) {
            return (0, apiResponse_1.sendError)(res, 500, 'Unable to fetch your classes right now. Please try again later.', undefined, error.message);
        }
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Classes retrieved successfully.', { classes: data });
    }
    // Student logic: Get classes they are enrolled in
    const { data: memberData, error: memberError } = await supabaseClient_1.default
        .from('class_members')
        .select('class_id')
        .eq('user_id', userId)
        .returns();
    if (memberError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load your enrolled classes right now.', undefined, memberError.message);
    }
    const classIds = (memberData ?? []).map((item) => item.class_id);
    if (classIds.length === 0) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Classes retrieved successfully.', { classes: [] });
    }
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .select('*')
        .in('id', classIds)
        .eq('is_archived', false)
        .returns();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to fetch your classes right now. Please try again later.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Classes retrieved successfully.', { classes: data });
});
router.post('/', auth_1.requireTeacher, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['name', 'description']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required class details.', { missingFields }, 'Validation failed');
    }
    const { name, description } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || (description != null && (typeof description !== 'string' || description.length > 10_000))) {
        return (0, apiResponse_1.sendError)(res, 400, 'Class name or description is invalid.');
    }
    const join_code = generateJoinCode();
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .insert([{ name, description, teacher_id: req.user?.id, join_code }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your class could not be created at the moment. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Class created successfully.', { class: data });
});
// B4: POST /classes/enroll — lets a student join a class using a join_code.
// Looks up the class, checks for duplicate membership, then inserts into class_members.
router.post('/enroll', auth_1.requireStudent, (0, rateLimit_1.rateLimit)({ name: 'enroll', windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['join_code']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide a join code to enroll in a class.', { missingFields }, 'Validation failed');
    }
    const { join_code } = req.body;
    if (typeof join_code !== 'string' || !/^[A-Z0-9]{8}$/i.test(join_code.trim())) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please enter a valid eight-character join code.');
    }
    const studentId = req.user?.id;
    // Look up the class by its join_code.
    const { data: classData, error: classError } = await supabaseClient_1.default
        .from('classes')
        .select('id, name, is_archived')
        .eq('join_code', join_code.trim().toUpperCase())
        .single();
    if (classError || !classData) {
        return (0, apiResponse_1.sendError)(res, 404, 'No class found with that join code. Please check and try again.');
    }
    if (classData.is_archived) {
        return (0, apiResponse_1.sendError)(res, 409, 'This class is archived and is not accepting new students.');
    }
    // Prevent duplicate enrollment.
    const { data: existing } = await supabaseClient_1.default
        .from('class_members')
        .select('id')
        .eq('class_id', classData.id)
        .eq('user_id', studentId)
        .maybeSingle();
    if (existing) {
        return (0, apiResponse_1.sendError)(res, 409, 'You are already enrolled in this class.');
    }
    const { data, error } = await supabaseClient_1.default
        .from('class_members')
        .insert([{ class_id: classData.id, user_id: studentId }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Enrollment failed. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, `Successfully enrolled in "${classData.name}".`, { enrollment: data });
});
// PATCH /classes/:id — lets a teacher edit or archive one of their own classes.
// Accepts: name, description, is_archived. Verifies teacher ownership before updating.
router.patch('/:id', auth_1.requireTeacher, async (req, res) => {
    const { id } = req.params;
    const teacherId = req.user?.id;
    const { name, description, is_archived } = req.body;
    // Ensure at least one updatable field was provided.
    if (name === undefined && description === undefined && is_archived === undefined) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide at least one field to update (name, description, or is_archived).', undefined, 'Validation failed');
    }
    // Verify the teacher owns this class before allowing any changes.
    const { data: existing, error: fetchError } = await supabaseClient_1.default
        .from('classes')
        .select('id')
        .eq('id', id)
        .eq('teacher_id', teacherId)
        .maybeSingle();
    if (fetchError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to verify class ownership right now. Please try again.', undefined, fetchError.message);
    }
    if (!existing) {
        return (0, apiResponse_1.sendError)(res, 404, 'Class not found or you do not have permission to update it.');
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 200)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Class name is invalid.');
    }
    if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 10_000)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Class description is invalid.');
    }
    if (is_archived !== undefined && typeof is_archived !== 'boolean') {
        return (0, apiResponse_1.sendError)(res, 400, 'Archived state must be true or false.');
    }
    // Build the update payload from only the fields that were provided.
    const updates = {};
    if (name !== undefined)
        updates.name = name.trim();
    if (description !== undefined)
        updates.description = description;
    if (is_archived !== undefined)
        updates.is_archived = is_archived;
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to update the class right now. Please try again.', undefined, error.message);
    }
    const message = is_archived === true
        ? 'Class archived successfully.'
        : is_archived === false
            ? 'Class restored successfully.'
            : 'Class updated successfully.';
    return (0, apiResponse_1.sendSuccess)(res, 200, message, { class: data });
});
exports.default = router;
