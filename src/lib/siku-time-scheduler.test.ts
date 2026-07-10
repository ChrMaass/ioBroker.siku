import { expect } from 'chai';
import { getNextTimeCheckDelayMs } from './siku-time-scheduler';

describe('SIKU persistent time-check scheduler', () => {
    const intervalMs = 24 * 60 * 60 * 1000;
    const now = new Date('2026-07-10T12:00:00.000Z');

    it('runs immediately when a device has never been checked or is overdue', () => {
        expect(getNextTimeCheckDelayMs(now, [null], intervalMs)).to.equal(0);
        expect(getNextTimeCheckDelayMs(now, ['2026-07-09T11:59:59.000Z'], intervalMs)).to.equal(0);
    });

    it('continues the persisted 24-hour window after an adapter restart', () => {
        expect(getNextTimeCheckDelayMs(now, ['2026-07-10T06:00:00.000Z'], intervalMs)).to.equal(18 * 60 * 60 * 1000);
    });

    it('uses the earliest due enabled device and tolerates future/invalid timestamps', () => {
        expect(
            getNextTimeCheckDelayMs(
                now,
                ['2026-07-10T10:00:00.000Z', '2026-07-10T04:00:00.000Z', '2026-07-11T00:00:00.000Z'],
                intervalMs,
            ),
        ).to.equal(16 * 60 * 60 * 1000);
        expect(getNextTimeCheckDelayMs(now, ['invalid'], intervalMs)).to.equal(0);
        expect(getNextTimeCheckDelayMs(now, [], intervalMs)).to.equal(intervalMs);
    });
});
