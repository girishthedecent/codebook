import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { getMeHandler } from './auth.controller.js';

// Sign-up, sign-in, sign-out and OAuth are served by better-auth under /api/auth (see app.ts).
const authRouter = express.Router();

authRouter.get('/', requireAuth, getMeHandler);

export default authRouter;
