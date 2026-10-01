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
const submissionPolicy_1 = require("../utils/submissionPolicy");
const router = express_1.default.Router();
router.get('/', async (req, res) => {
    const role = req.user?.role;
    if (role === 'student') {
        const { data, error } = await supabaseClient_1.default
            .from('submissions')
            .select('id, student_id, assignment_id, final_text, final_html, status, submission_version, submitted_at, is_late, teacher_feedback, created_at, updated_at')
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
        .in('assignment_id', assignmentIds)
        .neq('status', 'draft');
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
    if (status !== 'draft' || typeof final_text !== 'string' || typeof final_html !== 'string'
        || final_text.length > 2_000_000 || final_html.length > 4_000_000) {
        return (0, apiResponse_1.sendError)(res, 400, 'New submissions must start as a draft with valid text.', undefined, 'Validation failed');
    }
    const allowedStatuses = ['draft', 'submitted'];
    if (!allowedStatuses.includes(status)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Invalid status value. Must be \'draft\' or \'submitted\'.', undefined, 'Validation failed');
    }
    const student_id = req.user?.id;
    const { data: assignmentData, error: assignmentCheckError } = await supabaseClient_1.default
        .from('assignments')
        .select('is_archived, class_id, due_date, word_limit, classes!inner(is_archived)')
        .eq('id', assignment_id)
        .single();
    if (assignmentCheckError || !assignmentData) {
        return (0, apiResponse_1.sendError)(res, 404, 'Assignment not found.', undefined, assignmentCheckError?.message);
    }
    const parentClass = Array.isArray(assignmentData.classes) ? assignmentData.classes[0] : assignmentData.classes;
    if (assignmentData.is_archived || parentClass?.is_archived) {
        return (0, apiResponse_1.sendError)(res, 409, 'This assignment has been archived and is no longer accepting submissions.');
    }
    try {
        if (!await (0, accessControl_1.isStudentEnrolled)(student_id, assignmentData.class_id)) {
            return (0, apiResponse_1.sendError)(res, 403, 'You must be enrolled in this assignment\'s class before starting work.');
        }
    }
    catch (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to verify class enrollment.', undefined, error.message);
    }
    // Return the canonical submission when the editor is reopened. The unique
    // database index remains the final protection against concurrent requests.
    const { data: existingSub, error: checkError } = await supabaseClient_1.default
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignment_id)
        .eq('student_id', student_id)
        .maybeSingle();
    if (checkError) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to check for an existing submission.', undefined, checkError.message);
    }
    if (existingSub) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Submission already exists.', { submission: existingSub });
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
    if (typeof final_text !== 'string' || typeof final_html !== 'string' || final_text.length > 2_000_000 || final_html.length > 4_000_000) {
        return (0, apiResponse_1.sendError)(res, 413, 'Submission content is too large.');
    }
    // Ownership check — student may only update their own submission.
    const { data: existing, error: fetchError } = await supabaseClient_1.default
        .from('submissions')
        .select('student_id, status, submission_version, assignment_id')
        .eq('id', submissionId)
        .single();
    if (fetchError || !existing) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    if (existing.student_id !== req.user?.id) {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. You can only update your own submissions.');
    }
    if (!(0, submissionPolicy_1.canStudentSave)(existing.status, status)) {
        return (0, apiResponse_1.sendError)(res, 409, 'This submission is locked. Your instructor must request a revision before it can be edited.');
    }
    const { data: assignment, error: assignmentError } = await supabaseClient_1.default
        .from('assignments')
        .select('due_date, word_limit, is_archived, classes!inner(is_archived)')
        .eq('id', existing.assignment_id)
        .single();
    if (assignmentError || !assignment) {
        return (0, apiResponse_1.sendError)(res, 404, 'Assignment not found.');
    }
    const parentClass = Array.isArray(assignment.classes) ? assignment.classes[0] : assignment.classes;
    if (assignment.is_archived || parentClass?.is_archived) {
        return (0, apiResponse_1.sendError)(res, 409, 'This assignment is archived and can no longer be edited.');
    }
    const wordCount = final_text.trim() ? final_text.trim().split(/\s+/).length : 0;
    if (status === 'submitted' && assignment.word_limit && wordCount > assignment.word_limit) {
        return (0, apiResponse_1.sendError)(res, 400, `This assignment has a ${assignment.word_limit}-word limit. Your document contains ${wordCount} words.`);
    }
    const nextVersion = (existing.submission_version ?? 0) + 1;
    const updatePayload = {
        final_text,
        final_html,
        submission_version: nextVersion,
        ai_score: null,
        analysis_data: null,
        analysis_revision: null,
        analysis_model_version: null,
        analysis_generated_at: null
    };
    if (status === 'submitted') {
        const submittedAt = new Date();
        updatePayload.status = 'submitted';
        updatePayload.submitted_at = submittedAt.toISOString();
        updatePayload.is_late = assignment.due_date ? submittedAt.getTime() > new Date(assignment.due_date).getTime() : false;
    }
    else if (existing.status === 'draft') {
        updatePayload.status = 'draft';
    }
    const { data, error } = await supabaseClient_1.default
        .from('submissions')
        .update(updatePayload)
        .eq('id', submissionId)
        .eq('status', existing.status)
        .eq('submission_version', existing.submission_version ?? 0)
        .select()
        .maybeSingle();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }
    if (!data) {
        return (0, apiResponse_1.sendError)(res, 409, 'This submission changed while you were editing. Reload the latest version before saving.');
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Submission saved successfully.', { submission: data });
});
// Teacher endpoint to grade/update status of a submission
router.patch('/:id/grade', auth_1.requireTeacher, async (req, res) => {
    const submissionId = req.params.id;
    const { status, feedback } = req.body;
    const allowedStatuses = ['graded', 'revision_requested', 'flagged'];
    if (!status || !allowedStatuses.includes(status)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Invalid status value. Must be \'graded\', \'revision_requested\', or \'flagged\'.', undefined, 'Validation failed');
    }
    if (feedback !== undefined && (typeof feedback !== 'string' || feedback.length > 5_000)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Feedback must be 5,000 characters or fewer.');
    }
    if ((0, submissionPolicy_1.needsTeacherFeedback)(status) && (typeof feedback !== 'string' || !feedback.trim())) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide specific feedback when flagging a submission or requesting a revision.');
    }
    const { data: existing, error: fetchError } = await supabaseClient_1.default
        .from('submissions')
        .select('assignment_id, status')
        .eq('id', submissionId)
        .single();
    if (fetchError || !existing) {
        return (0, apiResponse_1.sendError)(res, 404, 'Submission not found.');
    }
    if (existing.status === 'draft') {
        return (0, apiResponse_1.sendError)(res, 409, 'A draft cannot be reviewed until the student submits it.');
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
        .update({ status, teacher_feedback: feedback?.trim() || null })
        .eq('id', submissionId)
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Could not update the submission status. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Submission graded successfully.', { submission: data });
});
exports.default = router;
