// The monitoring date ranges, in days. Kept apart from the page so the route's search
// validation doesn't pull the charts into the main bundle.
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
