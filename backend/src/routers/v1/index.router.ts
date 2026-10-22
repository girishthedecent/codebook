import express from 'express';
import authRouter from '../../modules/auth/auth.router.js';
import healthRouter from '../../modules/health/health.router.js';
import workspaceRouter from '../../modules/workspaces/workspace.router.js';

const v1Router = express.Router();

v1Router.use('/health', healthRouter);
v1Router.use('/me', authRouter);
v1Router.use('/workspaces', workspaceRouter);

export default v1Router;
