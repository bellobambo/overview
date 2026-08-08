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
    if (role === 'student') {
        const { data, error } = await supabaseClient_1.default
            .from('submissions')
            .select('*')
            .eq('student_id', req.user?.id)
            .returns();
        if (error) {
            return (0, apiResponse_1.sendError)(res, 500, 'Unable to load your submissions right now. Please try again later.', undefined, error.message);
        }
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Submissions retrieved successfully.', { submissions: data });
    }
    const { data: assignmentData, error: assignmentError } = await supabaseClient_1.default
        .from('assignments')
        .select('id')
        .eq('teacher_id', req.user?.id)
        .returns();
    if (assignmentError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load submissions for your assignments right now.', undefined, assignmentError.message);
    }
    const assignmentIds = (assignmentData ?? []).map((item) => item.id);
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .select('*')
        .in('assignment_id', assignmentIds)
        .returns();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load submissions right now. Please try again later.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Submissions retrieved successfully.', { submissions: data });
});
router.post('/', auth_1.requireStudent, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['assignment_id', 'final_text', 'final_html']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required submission details.', { missingFields }, 'Validation failed');
    }
    const { assignment_id, final_text, final_html } = req.body;
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .insert([{ assignment_id, student_id: req.user?.id, final_text, final_html, status: 'submitted' }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Submission created successfully.', { submission: data });
});
exports.default = router;
