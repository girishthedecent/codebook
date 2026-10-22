import express from 'express';
import healthRouter from '../../modules/health/health.router.js';

const v1Router = express.Router();

v1Router.use('/health', healthRouter);

export default v1Router;
