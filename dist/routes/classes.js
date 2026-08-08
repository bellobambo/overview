"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
const apiResponse_1 = require("../utils/apiResponse");
const router = express_1.default.Router();
router.get('/', async (_req, res) => {
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .select('*')
        .eq('teacher_id', _req.user?.id)
        .returns();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Unable to fetch your classes right now. Please try again later.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 200, 'Classes retrieved successfully.', { classes: data });
});
router.post('/', async (req, res) => {
    const missingFields = (0, apiResponse_1.validateRequiredFields)(req.body, ['name', 'description']);
    if (missingFields.length > 0) {
        return (0, apiResponse_1.sendError)(res, 400, 'Please provide the required class details.', { missingFields }, 'Validation failed');
    }
    const { name, description } = req.body;
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .insert([{ name, description, teacher_id: req.user?.id }])
        .select()
        .single();
    if (error) {
        return (0, apiResponse_1.sendError)(res, 500, 'Your class could not be created at the moment. Please try again.', undefined, error.message);
    }
    return (0, apiResponse_1.sendSuccess)(res, 201, 'Class created successfully.', { class: data });
});
exports.default = router;
