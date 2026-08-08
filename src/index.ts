import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { authenticate, requireStudent, requireTeacher } from './middleware/auth';
import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import classesRouter from './routes/classes';
import assignmentsRouter from './routes/assignments';
import submissionsRouter from './routes/submissions';
import keystrokesRouter from './routes/keystrokes';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (_req: Request, res: Response) => res.json({
    status: 'ok',
    message: 'Overview backend API is running.',
    project: 'Overview is a classroom and assignment management platform for teachers and students.',
    endpoints: {
        auth: 'POST /auth/signup, POST /auth/signin, POST /auth/signout, POST /auth/refresh',
        profile: 'GET /profile',
        classes: 'GET /classes, POST /classes',
        assignments: 'GET /assignments, POST /assignments',
        submissions: 'GET /submissions, POST /submissions',
        keystrokes: 'POST /keystrokes, GET /keystrokes/:submissionId'
    }
}));

app.use('/auth', authRouter);
app.use('/profile', authenticate, profileRouter);
app.use('/classes', authenticate, requireTeacher, classesRouter);
app.use('/assignments', authenticate, assignmentsRouter);
app.use('/submissions', authenticate, submissionsRouter);
app.use('/keystrokes', authenticate, requireStudent, keystrokesRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
