import { expect } from 'chai';
import { buildPacket, parsePacket } from './siku-protocol';
import { SikuFunction } from './siku-constants';
import {
    calculateClockDriftSeconds,
    decodeRtcDate,
    decodeRtcSnapshot,
    encodeRtcCalendar,
    encodeRtcTime,
    getSikuWeekday,
} from './siku-time';

describe('SIKU time helpers', () => {
    it('encodes the RTC time and calendar fields using the local date components', () => {
        const date = new Date(2026, 3, 17, 5, 4, 3, 0);

        expect(encodeRtcTime(date)).to.deep.equal(Buffer.from([3, 4, 5]));
        expect(encodeRtcCalendar(date)).to.deep.equal(Buffer.from([17, 5, 4, 26]));
        expect(getSikuWeekday(date)).to.equal(5);
    });

    it('decodes RTC payloads into a valid local timestamp', () => {
        const decoded = decodeRtcDate(Buffer.from([3, 4, 5]), Buffer.from([17, 5, 4, 26]));

        expect(decoded.getFullYear()).to.equal(2026);
        expect(decoded.getMonth()).to.equal(3);
        expect(decoded.getDate()).to.equal(17);
        expect(decoded.getHours()).to.equal(5);
        expect(decoded.getMinutes()).to.equal(4);
        expect(decoded.getSeconds()).to.equal(3);
    });

    it('rejects malformed or impossible RTC payloads', () => {
        expect(() => decodeRtcDate(Buffer.from([0, 0]), Buffer.from([17, 5, 4, 26]))).to.throw(
            'RTC time payload must be exactly 3 bytes long, received 2',
        );
        expect(() => decodeRtcDate(Buffer.from([0, 0, 0]), Buffer.from([31, 1, 2, 26]))).to.throw(
            'RTC date payload does not represent a valid calendar date',
        );
    });

    it('extracts the RTC snapshot from a response packet', () => {
        const packet = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([0xfe, 0x03, 0x6f, 0x03, 0x04, 0x05, 0xfe, 0x04, 0x70, 0x11, 0x05, 0x04, 0x1a]),
        );

        const snapshot = decodeRtcSnapshot(parsePacket(packet));
        expect(snapshot.timeValue).to.deep.equal(Buffer.from([3, 4, 5]));
        expect(snapshot.calendarValue).to.deep.equal(Buffer.from([17, 5, 4, 26]));
        expect(snapshot.deviceDate.getFullYear()).to.equal(2026);
    });

    it('calculates the signed drift in seconds relative to the system time', () => {
        const deviceDate = new Date(2026, 3, 17, 5, 4, 55, 0);
        const referenceDate = new Date(2026, 3, 17, 5, 5, 7, 0);

        expect(calculateClockDriftSeconds(deviceDate, referenceDate)).to.equal(12);
        expect(calculateClockDriftSeconds(referenceDate, deviceDate)).to.equal(-12);
    });
});
