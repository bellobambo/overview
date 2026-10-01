"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = process.env.SUPABASE_URL;
let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) {
    serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
} else if (serviceRoleKey?.startsWith('sb_publishable_') && process.env.SUPABASE_SECRET_KEY) {
    serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
} else if (!serviceRoleKey && process.env.SUPABASE_SECRET_KEY) {
    serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
}
if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
}
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
});
exports.default = supabase;
