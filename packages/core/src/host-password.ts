// The host password's length limits (docs/PLAN.md, "Host sign-in"). They live here so the
// server enforces them and the setup screen shows the same numbers.

/** Host passwords are 8 to 128 characters. The cap keeps a huge body from costing a long hash. */
export const HOST_PASSWORD_MIN = 8;
export const HOST_PASSWORD_MAX = 128;
