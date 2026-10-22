import type { AuthSession } from '../config/auth.config.js';

declare global {
  namespace Express {
    interface Locals {
      user?: AuthSession['user'];
      session?: AuthSession['session'];
    }
  }
}

export {};
