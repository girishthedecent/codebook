import express from 'express';
import authRouter from '../../modules/auth/auth.router.js';
import { conversationRouter, messageRouter } from '../../modules/chat/conversation.router.js';
import { turnRouter } from '../../modules/chat/turn.router.js';
import { demoRouter } from '../../modules/demo/demo.router.js';
import { evalsRouter } from '../../modules/evals/evals.router.js';
import healthRouter from '../../modules/health/health.router.js';
import { memoryRouter } from '../../modules/memory/memory.router.js';
import { monitoringRouter } from '../../modules/monitoring/monitoring.router.js';
import { sourceRouter } from '../../modules/sources/source.router.js';
import { studyRouter } from '../../modules/study/study.router.js';
import { usageRouter } from '../../modules/usage/usage.router.js';
import workspaceRouter from '../../modules/workspaces/workspace.router.js';

// Every router under /api/v1 by its prefix, in mount order. The OpenAPI and route-auth
// tests walk this table, so a router mounted any other way would escape them.
export const v1Mounts: ReadonlyArray<readonly [prefix: string, router: express.Router]> = [
  ['/health', healthRouter],
  ['/me', authRouter],
  ['/demo', demoRouter],
  ['/workspaces', workspaceRouter],
  ['/sources', sourceRouter],
  ['/conversations', turnRouter],
  ['/conversations', conversationRouter],
  ['/messages', messageRouter],
  ['/memories', memoryRouter],
  ['/study', studyRouter],
  ['/usage', usageRouter],
  ['/monitoring', monitoringRouter],
  ['/evals', evalsRouter],
];

const v1Router = express.Router();
for (const [prefix, router] of v1Mounts) v1Router.use(prefix, router);

export default v1Router;
