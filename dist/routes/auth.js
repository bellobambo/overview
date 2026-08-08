"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const auth_1 = require("../middleware/auth");
const apiResponse_1 = require("../utils/apiResponse");
const router = express_1.default.Router();
// ─── POST /auth/signup ──────────────────────────────────────────
router.post('/signup', async (req, res) => {
    const { email, password, full_name, role } = req.body;
    const missing = (0, apiResponse_1.validateRequiredFields)(req.body, ['email', 'password', 'full_name', 'role']);
    if (missing.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, `Missing required fields: ${missing.join(', ')}.`);
    }
    const normalizedRole = typeof role === 'string' ? role.toLowerCase() : role;
    const validRoles = ['teacher', 'student'];
    if (!validRoles.includes(normalizedRole)) {
        return (0, apiResponse_1.sendError)(res, 400, 'Role must be "teacher" or "student".');
    }
    // 1. Create the user in Supabase Auth (stores role & full_name in user_metadata)
    const { data: authData, error: authError } = await supabaseClient_1.default.auth.signUp({
        email,
        password,
        options: {
            data: { role: normalizedRole, full_name }
        }
    });
    if (authError || !authData.user) {
        return (0, apiResponse_1.sendError)(res, 400, 'Unable to create account. Please try again.', undefined, authError?.message);
    }
    // 2. Create the matching profile row
    const { error: profileError } = await supabaseClient_1.default
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
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Account created successfully.', {
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
router.post('/signin', async (req, res) => {
    const { email, password } = req.body;
    const missing = (0, apiResponse_1.validateRequiredFields)(req.body, ['email', 'password']);
    if (missing.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, `Missing required fields: ${missing.join(', ')}.`);
    }
    const { data, error } = await supabaseClient_1.default.auth.signInWithPassword({
        email,
        password
    });
    if (error || !data.session) {
        return (0, apiResponse_1.sendError)(res, 401, 'Invalid email or password.', undefined, error?.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Signed in successfully.', {
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
router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
        return (0, apiResponse_1.sendError)(res, 400, 'refresh_token is required.');
    }
    const { data, error } = await supabaseClient_1.default.auth.refreshSession({ refresh_token });
    if (error || !data.session) {
        return (0, apiResponse_1.sendError)(res, 401, 'Session expired. Please sign in again.', undefined, error?.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Token refreshed successfully.', {
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
router.post('/signout', auth_1.authenticate, async (req, res) => {
    const token = req.headers.authorization.slice('Bearer '.length).trim();
    try {
        const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
            }
        });
        if (!response.ok) {
            return (0, apiResponse_1.sendError)(res, 500, 'Unable to sign out. Please try again later.');
        }
    }
    catch {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to sign out. Please try again later.');
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Signed out successfully.');
});
exports.default = router;
