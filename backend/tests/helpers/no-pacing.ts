// Stand-in for src/utils/pacer.ts: pacing only matters against the real free tier.
export const createPacer = () => () => Promise.resolve();

export const createWindowLimiter = () => ({
  take: () => Promise.resolve(),
  record: () => undefined,
});
