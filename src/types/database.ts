// ============================================
// Database row types (match Supabase table schemas)
// ============================================

export type UserRole = 'teacher' | 'student' | 'admin';
export type AiPolicy = 'allowed' | 'restricted' | 'forbidden';
export type SubmissionStatus = 'draft' | 'submitted' | 'graded';

export interface Profile {
    id: string;
    full_name: string | null;
    role: UserRole | null;
    class_ids: string[];
    school_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface Class {
    id: string;
    teacher_id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
}

export interface ClassMember {
    id: string;
    class_id: string;
    user_id: string;
    joined_at: string;
}

export interface Assignment {
    id: string;
    teacher_id: string;
    class_id: string;
    title: string;
    description: string | null;
    due_date: string | null;
    word_limit: number | null;
    ai_policy: AiPolicy | null;
    created_at: string;
    updated_at: string;
}

export interface Submission {
    id: string;
    student_id: string;
    assignment_id: string;
    final_text: string | null;
    final_html: string | null;
    status: SubmissionStatus;
    created_at: string;
    updated_at: string;
}

export interface KeystrokeLog {
    id: string;
    submission_id: string;
    events: Record<string, unknown>[];
    created_at: string;
}

// ============================================
// Request body types for POST endpoints
// ============================================

export interface CreateClassBody {
    name: string;
    description: string;
}

export interface CreateAssignmentBody {
    class_id: string;
    title: string;
    description: string;
    due_date: string;
    word_limit?: number;
    ai_policy?: AiPolicy;
}

export interface CreateSubmissionBody {
    assignment_id: string;
    final_text: string;
    final_html: string;
}

export interface CreateKeystrokeLogBody {
    submission_id: string;
    events: Record<string, unknown>[];
}
