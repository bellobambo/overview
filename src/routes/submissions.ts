import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { requireStudent, requireTeacher } from '../middleware/auth';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { Submission, Assignment, CreateSubmissionBody, UpdateSubmissionBody } from '../types/database';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    const role = req.user?.user_metadata?.role;

    if (role === 'student') {
        const { data, error } = await supabase
            .from('submissions')
            .select('*')
            .eq('student_id', req.user?.id as string)
            .returns<Submission[]>();

        if (error) {
            return sendError(res, 500, 'Unable to load your submissions right now. Please try again later.', undefined, error.message);
        }

        return sendSuccess(res, 200, 'Submissions retrieved successfully.', { submissions: data });
    }

    const { data: assignmentData, error: assignmentError } = await supabase
        .from('assignments')
        .select('id')
        .eq('teacher_id', req.user?.id as string)
        .returns<Pick<Assignment, 'id'>[]>();

    if (assignmentError) {
        return sendError(res, 500, 'Unable to load submissions for your assignments right now.', undefined, assignmentError.message);
    }

    const assignmentIds = (assignmentData ?? []).map((item) => item.id);
    
    if (assignmentIds.length === 0) {
        return sendSuccess(res, 200, 'Submissions retrieved successfully.', { submissions: [] });
    }

    const { data, error } = await supabase
        .from('submissions')
        .select('*, profiles!student_id(full_name)')
        .in('assignment_id', assignmentIds);

    if (error) {
        return sendError(res, 500, 'Unable to load submissions right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Submissions retrieved successfully.', { submissions: data });
});

// B2: POST — creates a submission; status defaults to 'draft' so the editor
// can immediately get a submission_id without counting as a final submission.
router.post('/', requireStudent, async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['assignment_id']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required submission details.', { missingFields }, 'Validation failed');
    }

    const { assignment_id, final_text = '', final_html = '', status = 'draft' } = req.body as CreateSubmissionBody;

    const allowedStatuses = ['draft', 'submitted'];
    if (!allowedStatuses.includes(status!)) {
        return sendError(res, 400, 'Invalid status value. Must be \'draft\' or \'submitted\'.', undefined, 'Validation failed');
    }

    const student_id = req.user?.id as string;

    // Prevent duplicate submissions by checking if one already exists
    const { data: existingSub, error: checkError } = await supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignment_id)
        .eq('student_id', student_id)
        .maybeSingle<Submission>();

    if (existingSub) {
        return sendSuccess(res, 200, 'Submission already exists.', { submission: existingSub });
    }

    const { data, error } = await supabase
        .from('submissions')
        .insert([{ assignment_id, student_id, final_text, final_html, status }])
        .select()
        .single<Submission>();

    if (error) {
        return sendError(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Submission created successfully.', { submission: data });
});

// B1: PATCH — autosave endpoint; students update their own draft every ~10 s.
// Verifies ownership before allowing any update.
router.patch('/:id', requireStudent, async (req: Request, res: Response) => {
    const submissionId: string = req.params.id;

    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['final_text', 'final_html']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required fields to save your submission.', { missingFields }, 'Validation failed');
    }

    const { final_text, final_html, status } = req.body as UpdateSubmissionBody;

    if (status !== undefined && !['draft', 'submitted'].includes(status)) {
        return sendError(res, 400, 'Invalid status value. Must be \'draft\' or \'submitted\'.', undefined, 'Validation failed');
    }

    // Ownership check — student may only update their own submission.
    const { data: existing, error: fetchError } = await supabase
        .from('submissions')
        .select('student_id, status')
        .eq('id', submissionId)
        .single<Pick<Submission, 'student_id' | 'status'>>();

    if (fetchError || !existing) {
        return sendError(res, 404, 'Submission not found.');
    }

    if (existing.student_id !== req.user?.id) {
        return sendError(res, 403, 'Access denied. You can only update your own submissions.');
    }

    // Prevent editing an already-graded submission.
    if (existing.status === 'graded') {
        return sendError(res, 409, 'This submission has already been graded and cannot be edited.');
    }

    const updatePayload: Partial<Submission> = { final_text, final_html };
    if (status !== undefined) updatePayload.status = status;

    const { data, error } = await supabase
        .from('submissions')
        .update(updatePayload)
        .eq('id', submissionId)
        .select()
        .single<Submission>();

    if (error) {
        return sendError(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Submission saved successfully.', { submission: data });
});

// Teacher endpoint to grade/update status of a submission
router.patch('/:id/grade', requireTeacher, async (req: Request, res: Response) => {
    const submissionId: string = req.params.id;
    const { status } = req.body as { status: string };

    const allowedStatuses = ['graded', 'revision_requested', 'flagged'];
    if (!status || !allowedStatuses.includes(status)) {
        return sendError(res, 400, 'Invalid status value. Must be \'graded\', \'revision_requested\', or \'flagged\'.', undefined, 'Validation failed');
    }

    const { data: existing, error: fetchError } = await supabase
        .from('submissions')
        .select('assignment_id')
        .eq('id', submissionId)
        .single<{ assignment_id: string }>();

    if (fetchError || !existing) {
        return sendError(res, 404, 'Submission not found.');
    }

    // Verify teacher owns the assignment (simplified for now, ideally checking assignments.teacher_id)
    const { data: assignment, error: assignmentError } = await supabase
        .from('assignments')
        .select('teacher_id')
        .eq('id', existing.assignment_id)
        .single<{ teacher_id: string }>();

    if (assignmentError || !assignment || assignment.teacher_id !== req.user?.id) {
        return sendError(res, 403, 'Access denied. You can only grade submissions for your own assignments.');
    }

    const { data, error } = await supabase
        .from('submissions')
        .update({ status })
        .eq('id', submissionId)
        .select()
        .single<Submission>();

    if (error) {
        return sendError(res, 500, 'Could not update the submission status. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Submission graded successfully.', { submission: data });
});

export default router;
