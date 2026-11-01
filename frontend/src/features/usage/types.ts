import type { Usage } from '@/api/types';

/** One day of the requester's usage, zero-filled, as `GET /usage/me` lists it in `days`. */
export type UsageDay = {
  /** `YYYY-MM-DD`, a UTC day. */
  date: string;
  questions: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

/** The usage reply with its last 14 days, oldest first. */
export type UsageWithDays = Usage & { days: UsageDay[] };
