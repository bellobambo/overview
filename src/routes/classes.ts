import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { Class, CreateClassBody } from '../types/database';

const router = express.Router();

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
    const { data, error } = await supabase
        .from('classes')
        .insert([{ name, description, teacher_id: req.user?.id as string }])
        .select()
        .single<Class>();

    if (error) {
        return sendError(res, 500, 'Your class could not be created at the moment. Please try again.', undefined, error.message);
    }

    return sendSuccess(res, 201, 'Class created successfully.', { class: data });
});

export default router;
