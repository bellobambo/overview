import { Request, Response, NextFunction } from 'express';
import supabase from '../supabaseClient';
import { sendError } from '../utils/apiResponse';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
    try {
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

    let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();

    let userRole = profileData?.role;

    if (!userRole) {
        // Self-heal: check if role is present in Supabase Auth user_metadata
        const metaRole = (data.user.user_metadata as any)?.role;
        const metaFullName = (data.user.user_metadata as any)?.full_name || null;
        if (metaRole && (metaRole === 'teacher' || metaRole === 'student')) {
            console.log(`[Auth] Auto-healing missing profile for user ${data.user.id} with role ${metaRole}...`);
            const { data: healedProfile, error: healError } = await supabase
                .from('profiles')
                .upsert({
                    id: data.user.id,
                    role: metaRole,
                    full_name: metaFullName,
                    class_ids: []
                })
                .select('role')
                .single();
            if (!healError && healedProfile?.role) {
                userRole = healedProfile.role;
            } else if (healError) {
                console.error('[Auth] Profile self-healing failed:', healError.message);
            }
        }
    }

    if (!userRole) {
        return sendError(res, 403, 'Your account profile is incomplete. Please contact support.', undefined, profileError?.message);
    }

    req.user = {
        id: data.user.id,
        email: data.user.email ?? undefined,
        user_metadata: {
            ...(data.user.user_metadata as Express.UserMetadata | undefined),
            role: userRole
        },
        role: userRole
    };
    next();
    } catch (error) {
        next(error);
    }
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
