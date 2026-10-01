import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { requireTeacher } from '../middleware/auth';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { Assignment, ClassMember, CreateAssignmentBody, UpdateAssignmentBody } from '../types/database';
import { getOwnedClass } from '../utils/accessControl';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    const role = req.user?.role;
    const userId = req.user?.id;

    if (!userId) {
        return sendError(res, 401, 'Authentication required. Please sign in again to continue.');
    }

    if (role === 'teacher') {
        const { data: activeClasses, error: classError } = await supabase
            .from('classes')
            .select('id')
            .eq('teacher_id', userId)
            .eq('is_archived', false);

        if (classError) {
            return sendError(res, 500, 'Unable to load your active classes.', undefined, classError.message);
        }
        const activeClassIds = (activeClasses ?? []).map(item => item.id);
        if (activeClassIds.length === 0) {
            return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: [] });
        }

        const { data, error } = await supabase
            .from('assignments')
            .select('*')
            .eq('teacher_id', userId)
            .in('class_id', activeClassIds)
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

    const enrolledClassIds = (memberData ?? []).map((item) => item.class_id);
    
    if (enrolledClassIds.length === 0) {
        return sendSuccess(res, 200, 'Assignments retrieved successfully.', { assignments: [] });
    }

    const { data: activeClasses, error: activeClassError } = await supabase
        .from('classes')
        .select('id')
        .in('id', enrolledClassIds)
        .eq('is_archived', false);

    if (activeClassError) {
        return sendError(res, 500, 'Unable to load active class assignments.', undefined, activeClassError.message);
    }
    const classIds = (activeClasses ?? []).map(item => item.id);
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

    if (typeof title !== 'string' || title.trim().length > 200 || typeof description !== 'string' || description.length > 10_000) {
        return sendError(res, 400, 'Assignment title or description is invalid.');
    }
    if (Number.isNaN(Date.parse(due_date))) {
        return sendError(res, 400, 'Please provide a valid due date.');
    }
    if (word_limit != null && (!Number.isInteger(word_limit) || word_limit < 1 || word_limit > 100_000)) {
        return sendError(res, 400, 'Word limit must be a whole number between 1 and 100,000.');
    }
    if (normalizedAiPolicy != null && !['allowed', 'restricted', 'forbidden'].includes(normalizedAiPolicy)) {
        return sendError(res, 400, 'AI policy must be allowed, restricted, or forbidden.');
    }

    try {
        const ownedClass = await getOwnedClass(class_id, req.user?.id as string);
        if (!ownedClass || ownedClass.is_archived) {
            return sendError(res, 404, 'Active class not found or you do not have permission to use it.');
        }
    } catch (error: any) {
        return sendError(res, 500, 'Unable to verify class ownership.', undefined, error.message);
    }

    const { data, error } = await supabase
        .from('assignments')
        .insert([{ class_id, title: title.trim(), description: description.trim(), due_date, word_limit: word_limit ?? null, ai_policy: normalizedAiPolicy ?? null, teacher_id: req.user?.id as string }])
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

    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 200)) {
        return sendError(res, 400, 'Assignment title is invalid.');
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 10_000)) {
        return sendError(res, 400, 'Assignment description is invalid.');
    }
    if (due_date !== undefined && (typeof due_date !== 'string' || Number.isNaN(Date.parse(due_date)))) {
        return sendError(res, 400, 'Please provide a valid due date.');
    }
    if (word_limit !== undefined && word_limit !== null && (!Number.isInteger(word_limit) || word_limit < 1 || word_limit > 100_000)) {
        return sendError(res, 400, 'Word limit must be a whole number between 1 and 100,000.');
    }
    if (ai_policy !== undefined && ai_policy !== null && (typeof ai_policy !== 'string' || !['allowed', 'restricted', 'forbidden'].includes(ai_policy.toLowerCase()))) {
        return sendError(res, 400, 'AI policy must be allowed, restricted, or forbidden.');
    }
    if (is_archived !== undefined && typeof is_archived !== 'boolean') {
        return sendError(res, 400, 'Archived state must be true or false.');
    }

    // Build the update payload from only the fields that were provided.
    const updates: Partial<Pick<Assignment, 'title' | 'description' | 'due_date' | 'word_limit' | 'ai_policy' | 'is_archived'>> = {};
    if (title !== undefined) updates.title = title.trim();
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
