import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    const role = req.user?.user_metadata?.role;
    const userId = req.user?.id;

    if (!userId) {
        return sendError(res, 401, 'Authentication required. Please sign in again to continue.');
    }

    if (role === 'teacher') {
        const { data, error } = await supabase
            .from('assignments')
            .select('*')
            .eq('teacher_id', userId);

        if (error) {
            return sendError(res, 500, 'Unable to load assignments right now. Please try again later.', undefined, error.message);
        }

        return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: data });
    }

    const { data: memberData, error: memberError } = await supabase
        .from('class_members')
        .select('class_id')
        .eq('user_id', req.user?.id);

    if (memberError) {
        return sendError(res, 500, 'Unable to load your class assignments right now.', undefined, memberError.message);
    }

    const classIds = (memberData || []).map((item: { class_id: string }) => item.class_id);
    const { data, error } = await supabase
        .from('assignments')
        .select('*')
        .in('class_id', classIds);

    if (error) {
        return sendError(res, 500, 'Unable to load assignments right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: data });
});

router.post('/', async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body, ['class_id', 'title', 'description', 'due_date']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required assignment details.', { missingFields }, 'Validation failed');
    }

    const { class_id, title, description, due_date, word_limit, ai_policy } = req.body;
    const { data, error } = await supabase
        .from('assignments')
        .insert([{ class_id, title, description, due_date, word_limit, ai_policy, teacher_id: req.user?.id }])
        .single();

    if (error) {
        return sendError(res, 500, 'The assignment could not be created. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Assignment created successfully.', { assignment: data });
});

export default router;
