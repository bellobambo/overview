"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOwnedClass = getOwnedClass;
exports.isStudentEnrolled = isStudentEnrolled;
exports.getSubmissionAccess = getSubmissionAccess;
const supabaseClient_1 = __importDefault(require("../supabaseClient"));
async function getOwnedClass(classId, teacherId) {
    const { data, error } = await supabaseClient_1.default
        .from('classes')
        .select('id, teacher_id, is_archived')
        .eq('id', classId)
        .eq('teacher_id', teacherId)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data;
}
async function isStudentEnrolled(studentId, classId) {
    const { data, error } = await supabaseClient_1.default
        .from('class_members')
        .select('id')
        .eq('user_id', studentId)
        .eq('class_id', classId)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return Boolean(data);
}
async function getSubmissionAccess(submissionId, user, options = {}) {
    const { data: submission, error: submissionError } = await supabaseClient_1.default
        .from('submissions')
        .select('id, student_id, assignment_id, status, submission_version')
        .eq('id', submissionId)
        .maybeSingle();
    if (submissionError)
        throw new Error(submissionError.message);
    if (!submission)
        return null;
    const { data: assignment, error: assignmentError } = await supabaseClient_1.default
        .from('assignments')
        .select('id, teacher_id, class_id, is_archived, due_date, word_limit, ai_policy')
        .eq('id', submission.assignment_id)
        .maybeSingle();
    if (assignmentError)
        throw new Error(assignmentError.message);
    if (!assignment)
        return null;
    const isOwner = user.role === 'student' && submission.student_id === user.id;
    const isTeacher = user.role === 'teacher' && assignment.teacher_id === user.id;
    const teacherCanView = isTeacher && (options.teacherMayViewDraft || submission.status !== 'draft');
    if (!isOwner && !teacherCanView)
        return null;
    return {
        ...submission,
        submission_version: submission.submission_version ?? 0,
        assignment
    };
}
