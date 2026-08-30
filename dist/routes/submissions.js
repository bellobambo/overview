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
        .eq('is_archived', false)
        .returns();
    if (assignmentError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load submissions for your assignments right now.', undefined, assignmentError.message);
    }
    const assignmentIds = (assignmentData ?? []).map((item) => item.id);
    if (assignmentIds.length === 0) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Submissions retrieved successfully.', { submissions: [] });
    }
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .select('*, profiles!student_id(full_name)')
        .in('assignment_id', assignmentIds);
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load submissions right now. Please try again later.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Submissions retrieved successfully.', { submissions: data });
});
// B2: POST — creates a submission; status defaults to 'draft' so the editor
// can immediately get a submission_id without counting as a final submission.
router.post('/', auth_1.requireStudent, async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['assignment_id']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required submission details.', { missingFields }, 'Validation failed');
    }
    const { assignment_id, final_text = '', final_html = '', status = 'draft' } = req.body;
    const allowedStatuses = ['draft', 'submitted'];
    if (!allowedStatuses.includes(status)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Invalid status value. Must be \'draft\' or \'submitted\'.', undefined, 'Validation failed');
    }
    const student_id = req.user?.id;
    // Prevent duplicate submissions by checking if one already exists
    const { data: existingSub, error: checkError } = await supabaseClient_1.default
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignment_id)
        .eq('student_id', student_id)
        .maybeSingle();
    if (existingSub) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Submission already exists.', { submission: existingSub });
    }
    // Prevent submitting to an archived assignment.
    const { data: assignmentData, error: assignmentCheckError } = await supabaseClient_1.default
        .from('assignments')
        .select('is_archived')
        .eq('id', assignment_id)
        .single();
    if (assignmentCheckError || !assignmentData) {
        return (0, apiResponse_1.sendError)(res, 404, 'Assignment not found.', undefined, assignmentCheckError?.message);
    }
    if (assignmentData.is_archived) {
        return (0, apiResponse_1.sendError)(res, 409, 'This assignment has been archived and is no longer accepting submissions.');
    }
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .insert([{ assignment_id, student_id, final_text, final_html, status }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Submission created successfully.', { submission: data });
});
// B1: PATCH — autosave endpoint; students update their own draft every ~10 s.
// Verifies ownership before allowing any update.
router.patch('/:id', auth_1.requireStudent, async (req, res) => {
    const submissionId = req.params.id;
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['final_text', 'final_html']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required fields to save your submission.', { missingFields }, 'Validation failed');
    }
    const { final_text, final_html, status } = req.body;
    if (status !== undefined && !['draft', 'submitted'].includes(status)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Invalid status value. Must be \'draft\' or \'submitted\'.', undefined, 'Validation failed');
    }
    // Ownership check — student may only update their own submission.
    const { data: existing, error: fetchError } = await supabaseClient_1.default
        .from('submissions')
        .select('student_id, status')
        .eq('id', submissionId)
        .single();
    if (fetchError || !existing) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    if (existing.student_id !== req.user?.id) {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only update your own submissions.');
    }
    // Prevent editing an already-graded submission.
    if (existing.status === 'graded') {
        return (0, apiResponse_1.sendError)(res, 409, 'This submission has already been graded and cannot be edited.');
    }
    const updatePayload = { final_text, final_html };
    if (status !== undefined)
        updatePayload.status = status;
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .update(updatePayload)
        .eq('id', submissionId)
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Submission saved successfully.', { submission: data });
});
// Teacher endpoint to grade/update status of a submission
router.patch('/:id/grade', auth_1.requireTeacher, async (req, res) => {
    const submissionId = req.params.id;
    const { status } = req.body;
    const allowedStatuses = ['graded', 'revision_requested', 'flagged'];
    if (!status || !allowedStatuses.includes(status)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Invalid status value. Must be \'graded\', \'revision_requested\', or \'flagged\'.', undefined, 'Validation failed');
    }
    const { data: existing, error: fetchError } = await supabaseClient_1.default
        .from('submissions')
        .select('assignment_id')
        .eq('id', submissionId)
        .single();
    if (fetchError || !existing) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    // Verify teacher owns the assignment (simplified for now, ideally checking assignments.teacher_id)
    const { data: assignment, error: assignmentError } = await supabaseClient_1.default
        .from('assignments')
        .select('teacher_id')
        .eq('id', existing.assignment_id)
        .single();
    if (assignmentError || !assignment || assignment.teacher_id !== req.user?.id) {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only grade submissions for your own assignments.');
    }
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .update({ status })
        .eq('id', submissionId)
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Could not update the submission status. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Submission graded successfully.', { submission: data });
});
exports.default = router;
