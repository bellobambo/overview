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
/** Generates a random 8-character uppercase alphanumeric join code. */
function generateJoinCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase() +
        Math.random().toString(36).substring(2, 6).toUpperCase();
}
router.get('/', async (req, res) => {
    const role = req.user?.user_metadata?.role;
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
router.post('/enroll', auth_1.requireStudent, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['join_code']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide a join code to enroll in a class.', { missingFields }, 'Validation failed');
    }
    const { join_code } = req.body;
    const studentId = req.user?.id;
    // Look up the class by its join_code.
    const { data: classData, error: classError } = await supabaseClient_1.default
        .from('classes')
        .select('id, name')
        .eq('join_code', join_code.toUpperCase())
        .single();
    if (classError || !classData) {
        return (0, apiResponse_1.sendError)(res, 404, 'No class found with that join code. Please check and try again.');
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
    // Build the update payload from only the fields that were provided.
    const updates = {};
    if (name !== undefined)
        updates.name = name;
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
