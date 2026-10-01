import supabase from '../supabaseClient';
import type { SubmissionStatus, UserRole } from '../types/database';

export interface RequestUser {
    id: string;
    role?: UserRole;
}

export interface SubmissionAccessRecord {
    id: string;
    student_id: string;
    assignment_id: string;
    status: SubmissionStatus;
    submission_version: number;
    assignment: {
        id: string;
        teacher_id: string;
        class_id: string;
        is_archived: boolean;
        due_date: string | null;
        word_limit: number | null;
        ai_policy: 'allowed' | 'restricted' | 'forbidden' | null;
    };
}

export async function getOwnedClass(classId: string, teacherId: string) {
    const { data, error } = await supabase
        .from('classes')
        .select('id, teacher_id, is_archived')
        .eq('id', classId)
        .eq('teacher_id', teacherId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
}

export async function isStudentEnrolled(studentId: string, classId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('class_members')
        .select('id')
        .eq('user_id', studentId)
        .eq('class_id', classId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return Boolean(data);
}

export async function getSubmissionAccess(
    submissionId: string,
    user: RequestUser,
    options: { teacherMayViewDraft?: boolean } = {}
): Promise<SubmissionAccessRecord | null> {
    const { data: submission, error: submissionError } = await supabase
        .from('submissions')
        .select('id, student_id, assignment_id, status, submission_version')
        .eq('id', submissionId)
        .maybeSingle();

    if (submissionError) throw new Error(submissionError.message);
    if (!submission) return null;

    const { data: assignment, error: assignmentError } = await supabase
        .from('assignments')
        .select('id, teacher_id, class_id, is_archived, due_date, word_limit, ai_policy')
        .eq('id', submission.assignment_id)
        .maybeSingle();

    if (assignmentError) throw new Error(assignmentError.message);
    if (!assignment) return null;

    const isOwner = user.role === 'student' && submission.student_id === user.id;
    const isTeacher = user.role === 'teacher' && assignment.teacher_id === user.id;
    const teacherCanView = isTeacher && (options.teacherMayViewDraft || submission.status !== 'draft');

    if (!isOwner && !teacherCanView) return null;

    return {
        ...submission,
        submission_version: submission.submission_version ?? 0,
        assignment
    } as SubmissionAccessRecord;
}

