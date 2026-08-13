import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { requireStudent, requireTeacher } from '../middleware/auth';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { Class, ClassMember, CreateClassBody, EnrollClassBody } from '../types/database';

const router = express.Router();

/** Generates a random 8-character uppercase alphanumeric join code. */
function generateJoinCode(): string {
    return Math.random().toString(36).substring(2, 6).toUpperCase() +
           Math.random().toString(36).substring(2, 6).toUpperCase();
}

router.get('/', async (_req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', _req.user?.id as string)
        .returns<Class[]>();

    if (error) {
        return sendError(res, 500, 'Unable to fetch your classes right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Classes retrieved successfully.', { classes: data });
});

router.post('/', async (req: Request, res: Response) => {
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

export default router;
