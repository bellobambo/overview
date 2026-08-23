import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { requireTeacher } from '../middleware/auth';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { Assignment, ClassMember, CreateAssignmentBody, UpdateAssignmentBody } from '../types/database';

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
            .eq('teacher_id', userId)
            .eq('is_archived', false)
            .returns<Assignment[]>();

        if (error) {
            return sendError(res, 500, 'Unable to load assignments right now. Please try again later.', undefined, error.message);
        }

        return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: data });
    }

    const { data: memberData, error: memberError } = await supabase
        .from('class_members')
        .select('class_id')
        .eq('user_id', userId)
        .returns<Pick<ClassMember, 'class_id'>[]>();

    if (memberError) {
        return sendError(res, 500, 'Unable to load your class assignments right now.', undefined, memberError.message);
    }

    const classIds = (memberData ?? []).map((item) => item.class_id);
    
    if (classIds.length === 0) {
        return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: [] });
    }

    const { data, error } = await supabase
        .from('assignments')
        .select('*')
        .in('class_id', classIds)
        .eq('is_archived', false)
        .returns<Assignment[]>();

    if (error) {
        return sendError(res, 500, 'Unable to load assignments right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: data });
});

router.post('/', requireTeacher, async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['class_id', 'title', 'description', 'due_date']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required assignment details.', { missingFields }, 'Validation failed');
    }

    const { class_id, title, description, due_date, word_limit, ai_policy } = req.body as CreateAssignmentBody;
    const normalizedAiPolicy = typeof ai_policy === 'string' ? ai_policy.toLowerCase() : ai_policy;

    const { data, error } = await supabase
        .from('assignments')
        .insert([{ class_id, title, description, due_date, word_limit: word_limit ?? null, ai_policy: normalizedAiPolicy ?? null, teacher_id: req.user?.id as string }])
        .select()
        .single<Assignment>();

    if (error) {
        return sendError(res, 500, 'The assignment could not be created. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Assignment created successfully.', { assignment: data });
});

// PATCH /assignments/:id — lets a teacher edit or archive one of their own assignments.
// Accepts: title, description, due_date, word_limit, ai_policy, is_archived.
// Verifies teacher ownership before applying updates.
router.patch('/:id', requireTeacher, async (req: Request, res: Response) => {
    const { id } = req.params;
    const teacherId = req.user?.id as string;
    const { title, description, due_date, word_limit, ai_policy, is_archived } = req.body as UpdateAssignmentBody;

    // Ensure at least one updatable field was provided.
    if (
        title === undefined &&
        description === undefined &&
        due_date === undefined &&
        word_limit === undefined &&
        ai_policy === undefined &&
        is_archived === undefined
    ) {
        return sendError(res, 400, 'Please provide at least one field to update.', undefined, 'Validation failed');
    }

    // Verify the teacher owns this assignment before allowing any changes.
    const { data: existing, error: fetchError } = await supabase
        .from('assignments')
        .select('id')
        .eq('id', id)
        .eq('teacher_id', teacherId)
        .maybeSingle<Pick<Assignment, 'id'>>();

    if (fetchError) {
        return sendError(res, 500, 'Unable to verify assignment ownership right now. Please try again.', undefined, fetchError.message);
    }
    if (!existing) {
        return sendError(res, 404, 'Assignment not found or you do not have permission to update it.');
    }

    // Build the update payload from only the fields that were provided.
    const updates: Partial<Pick<Assignment, 'title' | 'description' | 'due_date' | 'word_limit' | 'ai_policy' | 'is_archived'>> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (due_date !== undefined) updates.due_date = due_date;
    if (word_limit !== undefined) updates.word_limit = word_limit;
    if (ai_policy !== undefined) updates.ai_policy = typeof ai_policy === 'string' ? (ai_policy as string).toLowerCase() as typeof ai_policy : ai_policy;
    if (is_archived !== undefined) updates.is_archived = is_archived;

    const { data, error } = await supabase
        .from('assignments')
        .update(updates)
        .eq('id', id)
        .select()
        .single<Assignment>();

    if (error) {
        return sendError(res, 500, 'Unable to update the assignment right now. Please try again.', undefined, error.message);
    }

    const message = is_archived === true
        ? 'Assignment archived successfully.'
        : is_archived === false
            ? 'Assignment restored successfully.'
            : 'Assignment updated successfully.';

    return sendSuccess(res, 200, message, { assignment: data });
});

export default router;
