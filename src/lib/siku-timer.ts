/** Maximum delay accepted by Node.js timers without overflow. */
export const SIKU_NODEJS_MAX_TIMER_MS = 2_147_483_647;

export const SIKU_DEFAULT_POLL_INTERVAL_SEC = 30;
export const SIKU_MIN_POLL_INTERVAL_SEC = 5;
export const SIKU_MAX_POLL_INTERVAL_SEC = Math.floor(SIKU_NODEJS_MAX_TIMER_MS / 1000);

export const SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS = 24;
export const SIKU_MIN_TIME_CHECK_INTERVAL_HOURS = 24;
export const SIKU_MAX_TIME_CHECK_INTERVAL_HOURS = Math.floor(SIKU_NODEJS_MAX_TIMER_MS / (60 * 60 * 1000));

function normalizeFiniteInteger(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.trunc(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Normalizes the user-configurable poll interval to a Node.js-safe timer delay.
 *
 * @param configuredSeconds - Raw value from native.pollIntervalSec
 */
export function getPollIntervalMs(configuredSeconds: unknown): number {
    const seconds = clampInteger(
        normalizeFiniteInteger(configuredSeconds, SIKU_DEFAULT_POLL_INTERVAL_SEC),
        SIKU_MIN_POLL_INTERVAL_SEC,
        SIKU_MAX_POLL_INTERVAL_SEC,
    );

    return seconds * 1000;
}

/**
 * Normalizes the user-configurable RTC check interval to a Node.js-safe timer delay.
 *
 * The lower bound intentionally remains 24 hours because the adapter should not read the
 * device RTC as part of regular polling or at a higher automatic frequency.
 *
 * @param configuredHours - Raw value from native.timeCheckIntervalHours
 */
export function getTimeCheckIntervalMs(configuredHours: unknown): number {
    const hours = clampInteger(
        normalizeFiniteInteger(configuredHours, SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS),
        SIKU_MIN_TIME_CHECK_INTERVAL_HOURS,
        SIKU_MAX_TIME_CHECK_INTERVAL_HOURS,
    );

    return hours * 60 * 60 * 1000;
}
