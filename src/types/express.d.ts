import { Request } from 'express';

declare global {
    namespace Express {
        interface UserMetadata {
            role?: string;
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
