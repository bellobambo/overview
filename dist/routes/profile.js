"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const apiResponse_1 = require("../utils/apiResponse");
const router = express_1.default.Router();
router.get('/', async (req, res) => {
    const userId = req.user?.id;
    const { data, error } = await supabaseClient_1.default
        .from('profiles')
        .select('full_name, role, class_ids, school_id')
        .eq('id', userId)
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to load your profile right now. Please try again later.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Profile retrieved successfully.', { user: { id: userId, email: req.user?.email, ...data } });
});
exports.default = router;
