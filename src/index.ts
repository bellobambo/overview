import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { authenticate, requireStudent, requireTeacher } from './middleware/auth';
import { sendSuccess, sendError } from './utils/apiResponse';
import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import classesRouter from './routes/classes';
import assignmentsRouter from './routes/assignments';
import submissionsRouter from './routes/submissions';
import keystrokesRouter from './routes/keystrokes';
import analysisRouter from './routes/analysis';
import settingsRouter from './routes/settings';
import { rateLimit } from './middleware/rateLimit';

export const app = express();
app.disable('x-powered-by');

const configuredOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,https://overview-lime.vercel.app')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type']
}));
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

const authLimiter = rateLimit({ name: 'auth', windowMs: 15 * 60_000, max: 30 });
const analysisLimiter = rateLimit({ name: 'analysis', windowMs: 60_000, max: 20 });

app.get('/', (_req: Request, res: Response) => {
    return sendSuccess(res, 200, 'Overview backend API is running.', {
        project: 'Overview is a classroom and assignment management platform for teachers and students.',
        endpoints: {
            auth: 'POST /auth/signup, POST /auth/signin, POST /auth/signout, POST /auth/refresh',
            profile: 'GET /profile',
            classes: 'GET /classes, POST /classes, PATCH /classes/:id',
            assignments: 'GET /assignments, POST /assignments, PATCH /assignments/:id',
            submissions: 'GET /submissions, POST /submissions, PATCH /submissions/:id, PATCH /submissions/:id/grade',
            keystrokes: 'POST /keystrokes, GET /keystrokes/:submissionId',
            settings: 'GET /settings, PUT /settings'
        }
    });
});

app.use('/auth', authLimiter, authRouter);
app.use('/profile', authenticate, profileRouter);
app.use('/classes', authenticate, classesRouter);
app.use('/assignments', authenticate, assignmentsRouter);
app.use('/submissions', authenticate, submissionsRouter);
app.use('/keystrokes', authenticate, keystrokesRouter);
app.use('/analysis', authenticate, analysisLimiter, analysisRouter);
app.use('/settings', authenticate, settingsRouter);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
        return sendError(res, 400, 'Invalid JSON format in request body. Please ensure your JSON is well-formed and does not contain comments.', undefined, 'SyntaxError');
    }

    console.error(err);
    return sendError(res, 500, 'Internal server error', undefined, err.message);
});

const port = Number(process.env.PORT ?? 4000);
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}
