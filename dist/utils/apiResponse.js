"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
exports.validateRequiredFields = validateRequiredFields;
function sendSuccess(res, statusCode, message, data) {
    return res.status(statusCode).json({
        success: true,
        message,
        ...(data !== undefined ? { data } : {})
    });
}
function sendError(res, statusCode, message, details, error) {
    const payload = {
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
function validateRequiredFields(body, requiredFields) {
    return requiredFields.filter((field) => {
        const value = body[field];
        return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    });
}
