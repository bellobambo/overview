import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../utils/apiResponse';

interface Bucket {
    count: number;
    resetAt: number;
}

export function rateLimit(options: { windowMs: number; max: number; name: string }) {
    const buckets = new Map<string, Bucket>();

    return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        const identity = req.user?.id || req.ip || req.socket.remoteAddress || 'unknown';
        const key = `${options.name}:${identity}`;
        const current = buckets.get(key);

        if (!current || current.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + options.windowMs });
            return next();
        }

        if (current.count >= options.max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
            res.setHeader('Retry-After', retryAfterSeconds.toString());
            return sendError(res, 429, 'Too many requests. Please wait a moment and try again.');
        }

        current.count += 1;
        if (buckets.size > 10_000) {
            for (const [bucketKey, bucket] of buckets) {
                if (bucket.resetAt <= now) buckets.delete(bucketKey);
            }
        }
        return next();
    };
}
