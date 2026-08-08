import type { UserRole } from './database';

declare global {
    namespace Express {
        interface UserMetadata {
            role?: UserRole;
        }

        interface AuthenticatedUser {
            id: string;
            email?: string;
            user_metadata?: UserMetadata;
        }

        interface Request {
            user?: AuthenticatedUser;
        }
    }
}
