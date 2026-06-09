import { expect } from 'chai';
import {
    getPollIntervalMs,
    getTimeCheckIntervalMs,
    getTimeSyncThresholdSec,
    SIKU_MAX_POLL_INTERVAL_SEC,
    SIKU_MAX_TIME_CHECK_INTERVAL_HOURS,
    SIKU_MAX_TIME_SYNC_THRESHOLD_SEC,
    SIKU_NODEJS_MAX_TIMER_MS,
} from './siku-timer';

describe('siku-timer', () => {
    it('keeps poll timers inside the Node.js timer range', () => {
        expect(getPollIntervalMs(2)).to.equal(5_000);
        expect(getPollIntervalMs(30)).to.equal(30_000);
        expect(getPollIntervalMs(Number.POSITIVE_INFINITY)).to.equal(30_000);
        expect(getPollIntervalMs(SIKU_MAX_POLL_INTERVAL_SEC + 1000)).to.be.at.most(SIKU_NODEJS_MAX_TIMER_MS);
    });

    it('keeps automatic RTC checks at 24 hours or longer and inside the Node.js timer range', () => {
        expect(getTimeCheckIntervalMs(1)).to.equal(24 * 60 * 60 * 1000);
        expect(getTimeCheckIntervalMs(24)).to.equal(24 * 60 * 60 * 1000);
        expect(getTimeCheckIntervalMs(Number.NaN)).to.equal(24 * 60 * 60 * 1000);
        expect(getTimeCheckIntervalMs(SIKU_MAX_TIME_CHECK_INTERVAL_HOURS + 1000)).to.be.at.most(
            SIKU_NODEJS_MAX_TIMER_MS,
        );
    });

    it('keeps the RTC sync threshold positive and bounded', () => {
        expect(getTimeSyncThresholdSec(0)).to.equal(10);
        expect(getTimeSyncThresholdSec(10)).to.equal(10);
        expect(getTimeSyncThresholdSec(Number.NaN)).to.equal(10);
        expect(getTimeSyncThresholdSec(SIKU_MAX_TIME_SYNC_THRESHOLD_SEC + 1000)).to.equal(
            SIKU_MAX_TIME_SYNC_THRESHOLD_SEC,
        );
    });
});
