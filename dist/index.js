"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const auth_1 = require("./middleware/auth");
const auth_2 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const classes_1 = __importDefault(require("./routes/classes"));
const assignments_1 = __importDefault(require("./routes/assignments"));
const submissions_1 = __importDefault(require("./routes/submissions"));
const keystrokes_1 = __importDefault(require("./routes/keystrokes"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use((0, morgan_1.default)('dev'));
app.get('/', (_req, res) => res.json({
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
app.use('/auth', auth_2.default);
app.use('/profile', auth_1.authenticate, profile_1.default);
app.use('/classes', auth_1.authenticate, auth_1.requireTeacher, classes_1.default);
app.use('/assignments', auth_1.authenticate, assignments_1.default);
app.use('/submissions', auth_1.authenticate, submissions_1.default);
app.use('/keystrokes', auth_1.authenticate, auth_1.requireStudent, keystrokes_1.default);
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
