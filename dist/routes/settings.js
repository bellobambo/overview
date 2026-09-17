"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const apiResponse_1 = require("../utils/apiResponse");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// GET /settings - Retrieve teacher settings (defaults to 70 if not yet customized)
router.get('/', auth_1.requireTeacher, async (req, res) => {
    const teacherId = req.user?.id;
    if (!teacherId) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication required.');
    }
    try {
        const { data, error } = await supabaseClient_1.default
            .from('teacher_settings')
            .select('flag_threshold, updated_at')
            .eq('teacher_id', teacherId)
            .maybeSingle();
        if (error) {
            // If table doesn't exist yet or query fails, fallback gracefully to default 70
            console.warn('[Settings] Error querying teacher_settings:', error.message);
            return (0, apiResponse_1.sendSuccess)(res, 200, 'Settings retrieved (default).', {
                settings: { flag_threshold: 70 }
            });
        }
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Settings retrieved successfully.', {
            settings: {
                flag_threshold: data?.flag_threshold ?? 70,
                updated_at: data?.updated_at
            }
        });
    }
    catch (e) {
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Settings fallback.', {
            settings: { flag_threshold: 70 }
        });
    }
});
// PUT /settings - Update teacher settings (only flag_threshold is adjustable)
router.put('/', auth_1.requireTeacher, async (req, res) => {
    const teacherId = req.user?.id;
    if (!teacherId) {
        return (0, apiResponse_1.sendError)(res, 401, 'Authentication required.');
    }
    const { flag_threshold } = req.body;
    if (![60, 70, 80].includes(Number(flag_threshold))) {
        return (0, apiResponse_1.sendError)(res, 400, 'Invalid flag_threshold. Must be 60, 70, or 80.');
    }
    try {
        const { data, error } = await supabaseClient_1.default
            .from('teacher_settings')
            .upsert({
            teacher_id: teacherId,
            flag_threshold: Number(flag_threshold),
            updated_at: new Date().toISOString()
        }, { onConflict: 'teacher_id' })
            .select()
            .single();
        if (error) {
            return (0, apiResponse_1.sendError)(res, 500, 'Failed to save settings to database. Please check Supabase migration.', undefined, error.message);
        }
        return (0, apiResponse_1.sendSuccess)(res, 200, 'Settings updated successfully.', {
            settings: data
        });
    }
    catch (e) {
        return (0, apiResponse_1.sendError)(res, 500, 'Failed to update settings.', undefined, e.message);
    }
});
exports.default = router;
