"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireTeacher = requireTeacher;
exports.requireStudent = requireStudent;
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const apiResponse_1 = require("../utils/apiResponse");
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication required. Please provide a valid bearer token.', undefined, 'Authorization header missing or malformed');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication failed. The access token is empty.', undefined, 'Authorization token is empty');
    }
    const { data, error } = await supabaseClient_1.default.auth.getUser(token);
    if (error || !data?.user) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication failed. Your session may have expired.', undefined, 'Invalid or expired access token');
    }
    const { data: profileData } = await supabaseClient_1.default
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();
    req.user = {
        id: data.user.id,
        email: data.user.email ?? undefined,
        user_metadata: data.user.user_metadata,
        role: profileData?.role ?? undefined
    };
    next();
}
function requireTeacher(req, res, next) {
    if (req.user?.role !== 'teacher') {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. Teacher privileges are required.', undefined, 'Teacher role required');
    }
    next();
}
function requireStudent(req, res, next) {
    if (req.user?.role !== 'student') {
        return (0, apiResponse_1.sendError)(res, 403, 'Access denied. Student privileges are required.', undefined, 'Student role required');
    }
    next();
}
