import express from 'express';
import authRouter from '../../modules/auth/auth.router.js';
import healthRouter from '../../modules/health/health.router.js';

const v1Router = express.Router();

v1Router.use('/health', healthRouter);
v1Router.use(authRouter);

export default v1Router;
