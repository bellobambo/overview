import express, { Request, Response } from 'express';
import supabase from '../supabaseClient';
import { authenticate } from '../middleware/auth';
import { sendError, sendSuccess, validateRequiredFields } from '../utils/apiResponse';
import type { UserRole } from '../types/database';

const router = express.Router();

// ─── POST /auth/signup ──────────────────────────────────────────
router.post('/signup', async (req: Request, res: Response) => {
    const { email, password, full_name, role } = req.body;

    const missing = validateRequiredFields(req.body, ['email', 'password', 'full_name', 'role']);
    if (missing.length > 0) {
        return sendError(res, 400, `Missing required fields: ${missing.join(', ')}.`);
    }

    const normalizedRole = typeof role === 'string' ? (role as string).toLowerCase() : role;
    const validRoles: UserRole[] = ['teacher', 'student'];
    if (!validRoles.includes(normalizedRole as UserRole)) {
        return sendError(res, 400, 'Role must be "teacher" or "student".');
    }

    // 1. Create the user in Supabase Auth (stores role & full_name in user_metadata)
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { role: normalizedRole, full_name }
        }
    });

    if (authError || !authData.user) {
        return sendError(res, 400, 'Unable to create account. Please try again.', undefined, authError?.message);
    }

    // 2. Create the matching profile row
    const { error: profileError } = await supabase
        .from('profiles')
        .insert({
            id: authData.user.id,
            full_name,
            role: normalizedRole,
            class_ids: [],
            school_id: null
        });

    if (profileError) {
        console.error('Profile creation failed (trigger may handle it):', profileError.message);
    }

    // 3. Return user info + session tokens
    return sendSuccess(res, 201, 'Account created successfully.', {
        user: {
            id: authData.user.id,
            email: authData.user.email,
            full_name,
            role: normalizedRole
        },
        session: authData.session
            ? {
                  access_token: authData.session.access_token,
                  refresh_token: authData.session.refresh_token,
                  token_type: 'bearer',
                  expires_in: authData.session.expires_in,
                  expires_at: authData.session.expires_at
              }
            : null
    });
});

// ─── POST /auth/signin ──────────────────────────────────────────
router.post('/signin', async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const missing = validateRequiredFields(req.body, ['email', 'password']);
    if (missing.length > 0) {
        return sendError(res, 400, `Missing required fields: ${missing.join(', ')}.`);
    }

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error || !data.session) {
        return sendError(res, 401, 'Invalid email or password.', undefined, error?.message);
    }

    return sendSuccess(res, 200, 'Signed in successfully.', {
        user: {
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.user_metadata?.full_name ?? null,
            role: data.user.user_metadata?.role ?? null
        },
        session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            token_type: 'bearer',
            expires_in: data.session.expires_in,
            expires_at: data.session.expires_at
        }
    });
});

// ─── POST /auth/refresh ─────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
    const { refresh_token } = req.body;

    if (!refresh_token) {
        return sendError(res, 400, 'refresh_token is required.');
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token });

    if (error || !data.session) {
        return sendError(res, 401, 'Session expired. Please sign in again.', undefined, error?.message);
    }

    return sendSuccess(res, 200, 'Token refreshed successfully.', {
        session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            token_type: 'bearer',
            expires_in: data.session.expires_in,
            expires_at: data.session.expires_at
        }
    });
});

// ─── POST /auth/signout ─────────────────────────────────────────
router.post('/signout', authenticate, async (req: Request, res: Response) => {
    const token = req.headers.authorization!.slice('Bearer '.length).trim();

    try {
        const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!
            }
        });

        if (!response.ok) {
            return sendError(res, 500, 'Unable to sign out. Please try again later.');
        }
    } catch {
        return sendError(res, 500, 'Unable to sign out. Please try again later.');
    }

    return sendSuccess(res, 200, 'Signed out successfully.');
});

export default router;
