"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canStudentEdit = canStudentEdit;
exports.canStudentSave = canStudentSave;
exports.needsTeacherFeedback = needsTeacherFeedback;
function canStudentEdit(status) {
    return status === 'draft' || status === 'revision_requested';
}
function canStudentSave(status, requestedStatus) {
    return canStudentEdit(status) &&
        (requestedStatus === undefined || requestedStatus === 'draft' || requestedStatus === 'submitted') &&
        !(status === 'revision_requested' && requestedStatus === 'draft');
}
function needsTeacherFeedback(status) {
    return status === 'flagged' || status === 'revision_requested';
}
