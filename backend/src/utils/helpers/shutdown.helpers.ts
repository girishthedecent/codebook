import logger from '../../config/logger.config.js';

export type ShutdownHook = () => Promise<unknown>;

export function createShutdownRegistry() {
  const hooks: ShutdownHook[] = [];

  return {
    register(hook: ShutdownHook) {
      hooks.push(hook);
    },

    /**
     * Runs every hook in the order it was registered. One failing hook is logged and the rest
     * still run. Resolves to false if any hook failed.
     */
    async run() {
      let ok = true;
      for (const hook of hooks) {
        try {
          await hook();
        } catch (error) {
          ok = false;
          logger.error('Shutdown hook failed', { error });
        }
      }
      return ok;
    },
  };
}

export const shutdownRegistry = createShutdownRegistry();
