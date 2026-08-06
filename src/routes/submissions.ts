import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    const role = req.user?.user_metadata?.role;

    if (role === 'student') {
        const { data, error } = await supabase
            .from('submissions')
            .select('*')
            .eq('student_id', req.user?.id);

        if (error) {
            return sendError(res, 500, 'Unable to load your submissions right now. Please try again later.', undefined, error.message);
        }

        return sendSuccess(res, 200, 'Submissions retrieved successfully.', { submissions: data });
    }

    const { data: assignmentData, error: assignmentError } = await supabase
        .from('assignments')
        .select('id')
        .eq('teacher_id', req.user?.id);

    if (assignmentError) {
        return sendError(res, 500, 'Unable to load submissions for your assignments right now.', undefined, assignmentError.message);
    }

    const assignmentIds = (assignmentData || []).map((item: { id: string }) => item.id);
    const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .in('assignment_id', assignmentIds);

    if (error) {
        return sendError(res, 500, 'Unable to load submissions right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Submissions retrieved successfully.', { submissions: data });
});

router.post('/', async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body, ['assignment_id', 'final_text', 'final_html']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required submission details.', { missingFields }, 'Validation failed');
    }

    const { assignment_id, final_text, final_html } = req.body;
    const { data, error } = await supabase
        .from('submissions')
        .insert([{ assignment_id, student_id: req.user?.id, final_text, final_html, status: 'submitted' }])
        .single();

    if (error) {
        return sendError(res, 500, 'Your submission could not be saved. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Submission created successfully.', { submission: data });
});

export default router;
