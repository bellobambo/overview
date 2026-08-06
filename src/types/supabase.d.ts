import { Database } from '@supabase/supabase-js';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email?: string;
                user_metadata?: {
                    role?: string;
                };
            };
        }
    }
}

export type Json = Database['public']['Tables'];
