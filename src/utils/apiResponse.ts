import { Response } from 'express';

export interface ApiErrorResponse {
    success: false;
    message: string;
    error?: string;
    details?: Record<string, unknown>;
}

export function sendSuccess<T>(res: Response, statusCode: number, message: string, data?: T) {
    return res.status(statusCode).json({
        success: true,
        message,
        ...(data !== undefined ? { data } : {})
    });
}

export function sendError(res: Response, statusCode: number, message: string, details?: Record<string, unknown>, error?: string) {
    const payload: ApiErrorResponse = {
        success: false,
        message
    };

    if (error) {
        payload.error = error;
    }

    if (details) {
        payload.details = details;
    }

    return res.status(statusCode).json(payload);
}

export function validateRequiredFields(body: Record<string, unknown>, requiredFields: string[]) {
    return requiredFields.filter((field) => {
        const value = body[field];
        return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    });
}
