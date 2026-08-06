import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { sendError, sendSuccess } from '../utils/apiResponse';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { data, error } = await supabase
        .from('profiles')
        .select('full_name, role, class_ids, school_id')
        .eq('id', userId)
        .single();

    if (error) {
        return sendError(res, 500, 'Unable to load your profile right now. Please try again later.', undefined, error.message);
    }

    return sendSuccess(res, 200, 'Profile retrieved successfully.', { user: { id: userId, email: req.user?.email, ...data } });
});

export default router;
