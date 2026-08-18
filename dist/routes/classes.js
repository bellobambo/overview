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
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .select('*')
        .in('id', classIds)
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
exports.default = router;
