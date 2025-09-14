import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import passport from 'passport';
import path from 'path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import csrf from 'csurf';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

import './passport.js';
import { pool } from './db/pool.js';
import securityMiddleware from './middleware/security.js';
import indexRouter from './routes/index.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import postsRouter from './routes/posts.js';
import topicsRouter from './routes/topics.js';
import usersRouter from './routes/users.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Views and static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// Security headers (very permissive for dev; tighten as needed)
app.use(helmet({
  contentSecurityPolicy: false
}));

// Parsing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

// Sessions (MySQL backed)
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'forum',
  password: process.env.DB_PASS || 'forumpw',
  database: process.env.DB_NAME || 'b2b_forum'
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// CSRF
const csrfProtection = csrf();
app.use((req, res, next) => {
  // Skip CSRF for OAuth callbacks and static
  const p = req.path || '';
  if (p.startsWith('/auth/discord')) return next();
  return csrfProtection(req, res, next);
});

// Make locals available to views
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  const cookieTheme = req.cookies?.theme;
  res.locals.theme = (cookieTheme === 'dark' || cookieTheme === 'light') ? cookieTheme : (req.session.theme || 'light');
  next();
});

// Custom security (sanitization helpers)
app.use(securityMiddleware);

// Routes
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/posts', postsRouter);
app.use('/topics', topicsRouter);
app.use('/users', usersRouter);

// 404
app.use((req, res) => {
  res.status(404).render('layout', {
    title: 'Not Found',
    body: '<h2>404 Not Found</h2>'
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
