import express from 'express';
import { getDemoHandler } from './demo.controller.js';

// Public: what the demo workspace holds, for visitors before they sign in as a guest.
export const demoRouter = express.Router();

demoRouter.get('/', getDemoHandler);
