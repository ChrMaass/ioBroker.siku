/**
 * Calculates the next RTC check from persisted per-device timestamps.
 *
 * A missing, invalid or overdue timestamp means the adapter should run the check immediately.
 * Future timestamps are treated as freshly checked to avoid a restart loop after clock changes.
 *
 * @param now - Current wall-clock time
 * @param lastCheckTimestamps - Persisted ISO timestamps of enabled devices
 * @param intervalMs - Normalized time-check interval
 * @param minimumDelayMs - Optional lower bound used for busy/error backoff
 */
export function getNextTimeCheckDelayMs(
    now: Date,
    lastCheckTimestamps: ReadonlyArray<string | null | undefined>,
    intervalMs: number,
    minimumDelayMs = 0,
): number {
    if (lastCheckTimestamps.length === 0) {
        return Math.max(intervalMs, minimumDelayMs);
    }

    let shortestDelay = intervalMs;
    for (const timestamp of lastCheckTimestamps) {
        if (!timestamp) {
            return minimumDelayMs;
        }

        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) {
            return minimumDelayMs;
        }

        const elapsedMs = Math.max(now.getTime() - parsed.getTime(), 0);
        if (elapsedMs >= intervalMs) {
            return minimumDelayMs;
        }

        shortestDelay = Math.min(shortestDelay, intervalMs - elapsedMs);
    }

    return Math.max(shortestDelay, minimumDelayMs);
}
