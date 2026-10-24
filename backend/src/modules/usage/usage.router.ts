import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { myUsageHandler } from './usage.controller.js';

// /usage/me.
export const usageRouter = express.Router();

usageRouter.get('/me', requireAuth, myUsageHandler);
