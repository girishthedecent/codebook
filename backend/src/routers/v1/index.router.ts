import express from 'express';
import authRouter from '../../modules/auth/auth.router.js';
import { conversationRouter, messageRouter } from '../../modules/chat/conversation.router.js';
import { turnRouter } from '../../modules/chat/turn.router.js';
import { evalsRouter } from '../../modules/evals/evals.router.js';
import healthRouter from '../../modules/health/health.router.js';
import { memoryRouter } from '../../modules/memory/memory.router.js';
import { monitoringRouter } from '../../modules/monitoring/monitoring.router.js';
import { sourceRouter } from '../../modules/sources/source.router.js';
import { studyRouter } from '../../modules/study/study.router.js';
import { usageRouter } from '../../modules/usage/usage.router.js';
import workspaceRouter from '../../modules/workspaces/workspace.router.js';

const v1Router = express.Router();

v1Router.use('/health', healthRouter);
v1Router.use('/me', authRouter);
v1Router.use('/workspaces', workspaceRouter);
v1Router.use('/sources', sourceRouter);
v1Router.use('/conversations', turnRouter);
v1Router.use('/conversations', conversationRouter);
v1Router.use('/messages', messageRouter);
v1Router.use('/memories', memoryRouter);
v1Router.use('/study', studyRouter);
v1Router.use('/usage', usageRouter);
v1Router.use('/monitoring', monitoringRouter);
v1Router.use('/evals', evalsRouter);

export default v1Router;
