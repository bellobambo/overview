import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { requireStudent, requireTeacher } from '../middleware/auth';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { Class, ClassMember, CreateClassBody, EnrollClassBody, UpdateClassBody } from '../types/database';

const router = express.Router();

/** Generates a random 8-character uppercase alphanumeric join code. */
function generateJoinCode(): string {
    return Math.random().toString(36).substring(2, 6).toUpperCase() +
           Math.random().toString(36).substring(2, 6).toUpperCase();
}

router.get('/', async (req: Request, res: Response) => {
    const role = req.user?.user_metadata?.role;
    const userId = req.user?.id as string;

    if (role === 'teacher') {
        const { data, error } = await supabase
            .from('classes')
            .select('*')
            .eq('teacher_id', userId)
            .eq('is_archived', false)
            .returns<Class[]>();

        if (error) {
            return sendError(res, 500, 'Unable to fetch your classes right now. Please try again later.', undefined, error.message);
        }
        return sendSuccess(res, 200, 'Classes retrieved successfully.', { classes: data });
    }

    // Student logic: Get classes they are enrolled in
    const { data: memberData, error: memberError } = await supabase
        .from('class_members')
        .select('class_id')
        .eq('user_id', userId)
        .returns<Pick<ClassMember, 'class_id'>[]>();

    if (memberError) {
        return sendError(res, 500, 'Unable to load your enrolled classes right now.', undefined, memberError.message);
    }

    const classIds = (memberData ?? []).map((item) => item.class_id);
    
    if (classIds.length === 0) {
        return sendSuccess(res, 200, 'Classes retrieved successfully.', { classes: [] });
    }

    const { data, error } = await supabase
        .from('classes')
        .select('*')
        .in('id', classIds)
        .eq('is_archived', false)
        .returns<Class[]>();

    if (error) {
        return sendError(res, 500, 'Unable to fetch your classes right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Classes retrieved successfully.', { classes: data });
});

router.post('/', requireTeacher, async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['name', 'description']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide the required class details.', { missingFields }, 'Validation failed');
    }

    const { name, description } = req.body as CreateClassBody;
    const join_code = generateJoinCode();

    const { data, error } = await supabase
        .from('classes')
        .insert([{ name, description, teacher_id: req.user?.id as string, join_code }])
        .select()
        .single<Class>();

    if (error) {
        return sendError(res, 500, 'Your class could not be created at the moment. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Class created successfully.', { class: data });
});

// B4: POST /classes/enroll — lets a student join a class using a join_code.
// Looks up the class, checks for duplicate membership, then inserts into class_members.
router.post('/enroll', requireStudent, async (req: Request, res: Response) => {
    const missingFields = validateRequiredFields(req.body as Record<string, unknown>, ['join_code']);
    if (missingFields.length > 0) {
        return sendError(res, 400, 'Please provide a join code to enroll in a class.', { missingFields }, 'Validation failed');
    }

    const { join_code } = req.body as EnrollClassBody;
    const studentId = req.user?.id as string;

    // Look up the class by its join_code.
    const { data: classData, error: classError } = await supabase
        .from('classes')
        .select('id, name')
        .eq('join_code', join_code.toUpperCase())
        .single<Pick<Class, 'id' | 'name'>>();

    if (classError || !classData) {
        return sendError(res, 404, 'No class found with that join code. Please check and try again.');
    }

    // Prevent duplicate enrollment.
    const { data: existing } = await supabase
        .from('class_members')
        .select('id')
        .eq('class_id', classData.id)
        .eq('user_id', studentId)
        .maybeSingle();

    if (existing) {
        return sendError(res, 409, 'You are already enrolled in this class.');
    }

    const { data, error } = await supabase
        .from('class_members')
        .insert([{ class_id: classData.id, user_id: studentId }])
        .select()
        .single<ClassMember>();

    if (error) {
        return sendError(res, 500, 'Enrollment failed. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, `Successfully enrolled in "${classData.name}".`, { enrollment: data });
});

// PATCH /classes/:id — lets a teacher edit or archive one of their own classes.
// Accepts: name, description, is_archived. Verifies teacher ownership before updating.
router.patch('/:id', requireTeacher, async (req: Request, res: Response) => {
    const { id } = req.params;
    const teacherId = req.user?.id as string;
    const { name, description, is_archived } = req.body as UpdateClassBody;

    // Ensure at least one updatable field was provided.
    if (name === undefined && description === undefined && is_archived === undefined) {
        return sendError(res, 400, 'Please provide at least one field to update (name, description, or is_archived).', undefined, 'Validation failed');
    }

    // Verify the teacher owns this class before allowing any changes.
    const { data: existing, error: fetchError } = await supabase
        .from('classes')
        .select('id')
        .eq('id', id)
        .eq('teacher_id', teacherId)
        .maybeSingle<Pick<Class, 'id'>>();

    if (fetchError) {
        return sendError(res, 500, 'Unable to verify class ownership right now. Please try again.', undefined, fetchError.message);
    }
    if (!existing) {
        return sendError(res, 404, 'Class not found or you do not have permission to update it.');
    }

    // Build the update payload from only the fields that were provided.
    const updates: Partial<Pick<Class, 'name' | 'description' | 'is_archived'>> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (is_archived !== undefined) updates.is_archived = is_archived;

    const { data, error } = await supabase
        .from('classes')
        .update(updates)
        .eq('id', id)
        .select()
        .single<Class>();

    if (error) {
        return sendError(res, 500, 'Unable to update the class right now. Please try again.', undefined, error.message);
    }

    const message = is_archived === true
        ? 'Class archived successfully.'
        : is_archived === false
            ? 'Class restored successfully.'
            : 'Class updated successfully.';

    return sendSuccess(res, 200, message, { class: data });
});

export default router;
