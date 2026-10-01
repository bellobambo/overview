export function canStudentEdit(status: string): boolean {
    return status === 'draft' || status === 'revision_requested';
}

export function canStudentSave(status: string, requestedStatus?: string): boolean {
    return canStudentEdit(status) &&
        (requestedStatus === undefined || requestedStatus === 'draft' || requestedStatus === 'submitted') &&
        !(status === 'revision_requested' && requestedStatus === 'draft');
}

export function needsTeacherFeedback(status: string): boolean {
    return status === 'flagged' || status === 'revision_requested';
}
