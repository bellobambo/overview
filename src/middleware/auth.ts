import { Request, Response, NextFunction } from 'express';
import supabase from '../supabaseClient';
import { sendError } from '../utils/apiResponse';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'Authentication required. Please provide a valid bearer token.', undefined, 'Authorization header missing or malformed');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
        return sendError(res, 401, 'Authentication failed. The access token is empty.', undefined, 'Authorization token is empty');
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return sendError(res, 401, 'Authentication failed. Your session may have expired.', undefined, 'Invalid or expired access token');
    }

    const { data: profileData } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

    req.user = {
        id: data.user.id,
        email: data.user.email ?? undefined,
        user_metadata: data.user.user_metadata as Express.UserMetadata | undefined,
        role: profileData?.role ?? undefined
    };
    next();
}

export function requireTeacher(req: Request, res: Response, next: NextFunction) {
    if (req.user?.role !== 'teacher') {
        return sendError(res, 403, 'Access denied. Teacher privileges are required.', undefined, 'Teacher role required');
    }
    next();
}

export function requireStudent(req: Request, res: Response, next: NextFunction) {
    if (req.user?.role !== 'student') {
        return sendError(res, 403, 'Access denied. Student privileges are required.', undefined, 'Student role required');
    }
    next();
}
