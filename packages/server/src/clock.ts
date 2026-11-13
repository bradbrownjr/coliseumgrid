// The clock the server reads for expiry, as a function so tests can move time themselves.

/** Milliseconds since the epoch, like Date.now. */
export type Clock = () => number;

export const iso = (ms: number): string => new Date(ms).toISOString();
