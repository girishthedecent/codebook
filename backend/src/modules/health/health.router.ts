import express from 'express';
import { getLivenessHandler, getReadinessHandler } from './health.controller.js';

const healthRouter = express.Router();

healthRouter.get('/live', getLivenessHandler);
healthRouter.get('/ready', getReadinessHandler);

export default healthRouter;
