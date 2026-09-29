import { expect } from 'chai';
import { SikuFunction } from './siku-constants';
import { buildPacket, parsePacket } from './siku-protocol';
import {
    buildScheduleReadRequests,
    buildScheduleReadRequestChunks,
    buildScheduleWriteRequest,
    buildScheduleWriteRequestFromSnapshot,
    decodeScheduleUpdates,
    getScheduleSnapshotStateIds,
    getScheduleStateDefinition,
    isScheduleStateId,
    readCompleteSchedulePackets,
    shouldRefreshSchedule,
} from './siku-schedule';

describe('SIKU schedule helpers', () => {
    it('builds one extended read request per weekday and period', () => {
        const requests = buildScheduleReadRequests();

        expect(requests).to.have.lengthOf(28);
        expect(requests[0]).to.deep.equal({
            parameter: 0x0077,
            valueSize: 2,
            requestValue: Buffer.from([0x01, 0x01]),
        });
        expect(requests[27]).to.deep.equal({
            parameter: 0x0077,
            valueSize: 2,
            requestValue: Buffer.from([0x07, 0x04]),
        });
    });

    it('splits schedule reads into two response-size-safe weekday chunks', () => {
        const chunks = buildScheduleReadRequestChunks();

        expect(chunks).to.have.lengthOf(2);
        expect(chunks.flat()).to.deep.equal(buildScheduleReadRequests());
        expect(chunks[0]).to.have.lengthOf(16);
        expect(chunks[1]).to.have.lengthOf(12);
        expect(chunks[0].every(entry => (entry.requestValue?.[0] ?? 0) <= 4)).to.equal(true);
        expect(chunks[1].every(entry => (entry.requestValue?.[0] ?? 0) >= 5)).to.equal(true);
    });

    it('returns schedule packets only after every chunk was read successfully', async () => {
        const calls: number[] = [];
        const packets = await readCompleteSchedulePackets(parameters => {
            calls.push(parameters.length);
            return Promise.resolve(`packet-${calls.length}`);
        });

        expect(calls).to.deep.equal([16, 12]);
        expect(packets).to.deep.equal(['packet-1', 'packet-2']);
    });

    it('rejects the complete schedule read instead of exposing partial packets', async () => {
        const calls: number[] = [];
        let returnedPackets: string[] | undefined;
        let thrownError: Error | undefined;

        try {
            returnedPackets = await readCompleteSchedulePackets(parameters => {
                calls.push(parameters.length);
                if (calls.length === 2) {
                    return Promise.reject(new Error('second chunk failed'));
                }
                return Promise.resolve('partial-packet');
            });
        } catch (error) {
            thrownError = error as Error;
        }

        expect(calls).to.deep.equal([16, 12]);
        expect(returnedPackets).to.equal(undefined);
        expect(thrownError?.message).to.equal('second chunk failed');
    });

    it('refreshes schedules on startup, after 15 minutes, after a failed read or after clock rollback', () => {
        const now = 1_000_000;
        expect(shouldRefreshSchedule('startup', now - 1_000, now)).to.equal(true);
        expect(shouldRefreshSchedule('interval', undefined, now)).to.equal(true);
        expect(shouldRefreshSchedule('interval', now - 14 * 60 * 1000, now)).to.equal(false);
        expect(shouldRefreshSchedule('interval', now - 15 * 60 * 1000, now)).to.equal(true);
        expect(shouldRefreshSchedule('interval', now + 1_000, now)).to.equal(true);
    });

    it('decodes schedule entries into weekday/period states', () => {
        const packet = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([
                0xfe, 0x06, 0x77, 0x01, 0x01, 0x02, 0x00, 0x1e, 0x06, 0xfe, 0x06, 0x77, 0x01, 0x02, 0x03, 0x00, 0x2d,
                0x09,
            ]),
        );

        const updates = decodeScheduleUpdates(parsePacket(packet));
        const asMap = new Map(updates.map(update => [update.relativeId, update.value]));

        expect(asMap.get('schedule.monday.p1.speed')).to.equal(2);
        expect(asMap.get('schedule.monday.p1.endHour')).to.equal(6);
        expect(asMap.get('schedule.monday.p1.endMinute')).to.equal(30);
        expect(asMap.get('schedule.monday.p2.speed')).to.equal(3);
        expect(asMap.get('schedule.monday.p2.endHour')).to.equal(9);
        expect(asMap.get('schedule.monday.p2.endMinute')).to.equal(45);
    });

    it('builds full 6-byte schedule write requests from the current period snapshot', () => {
        expect(
            buildScheduleWriteRequest('schedule.monday.p2.endMinute', {
                'schedule.monday.p2.speed': 3,
                'schedule.monday.p2.endHour': 9,
                'schedule.monday.p2.endMinute': 45,
            }),
        ).to.deep.equal({
            parameter: 0x0077,
            value: Buffer.from([0x01, 0x02, 0x03, 0x00, 0x2d, 0x09]),
        });
    });

    it('exposes schedule state metadata for subscriptions and snapshot loading', () => {
        expect(isScheduleStateId('schedule.sunday.p4.endHour')).to.equal(true);
        expect(isScheduleStateId('control.power')).to.equal(false);
        expect(getScheduleStateDefinition('schedule.sunday.p4.endHour')).to.include({
            dayKey: 'sunday',
            dayNumber: 7,
            periodNumber: 4,
            field: 'endHour',
        });
        expect(getScheduleSnapshotStateIds('schedule.sunday.p4.endHour')).to.deep.equal([
            'schedule.sunday.p4.speed',
            'schedule.sunday.p4.endHour',
            'schedule.sunday.p4.endMinute',
        ]);
        expect(getScheduleStateDefinition('schedule.sunday.p4.endHour')?.common).to.include({
            role: 'level',
            write: true,
        });
        expect(getScheduleStateDefinition('schedule.sunday.p4.endMinute')?.common).to.include({
            role: 'level',
            write: true,
        });
    });

    it('rejects incomplete or invalid schedule snapshots early', () => {
        expect(() =>
            buildScheduleWriteRequest('schedule.tuesday.p1.speed', {
                'schedule.tuesday.p1.speed': 4,
                'schedule.tuesday.p1.endHour': 8,
                'schedule.tuesday.p1.endMinute': 0,
            }),
        ).to.throw('Schedule speed must be an integer between 0 and 3');

        expect(() =>
            buildScheduleWriteRequest('schedule.tuesday.p1.speed', {
                'schedule.tuesday.p1.speed': 2,
                'schedule.tuesday.p1.endHour': 24,
                'schedule.tuesday.p1.endMinute': 0,
            }),
        ).to.throw('Schedule end hour must be an integer between 0 and 23');
    });

    it('rejects schedule writes that would reuse an unconfirmed sibling value', () => {
        expect(() =>
            buildScheduleWriteRequestFromSnapshot('schedule.monday.p1.endMinute', 30, [
                { relativeId: 'schedule.monday.p1.speed', value: 3, acknowledged: false },
                { relativeId: 'schedule.monday.p1.endHour', value: 8, acknowledged: true },
                { relativeId: 'schedule.monday.p1.endMinute', value: 15, acknowledged: false },
            ]),
        ).to.throw('Schedule snapshot state schedule.monday.p1.speed is not acknowledged');

        expect(
            buildScheduleWriteRequestFromSnapshot('schedule.monday.p1.endMinute', 30, [
                { relativeId: 'schedule.monday.p1.speed', value: 3, acknowledged: true },
                { relativeId: 'schedule.monday.p1.endHour', value: 8, acknowledged: true },
                { relativeId: 'schedule.monday.p1.endMinute', value: 15, acknowledged: false },
            ]),
        ).to.deep.equal({
            parameter: 0x0077,
            value: Buffer.from([0x01, 0x01, 0x03, 0x00, 0x1e, 0x08]),
        });

        expect(
            buildScheduleWriteRequestFromSnapshot('schedule.monday.p1.endMinute', 30, [
                {
                    relativeId: 'schedule.monday.p1.speed',
                    value: 2,
                    acknowledged: false,
                    pending: true,
                },
                { relativeId: 'schedule.monday.p1.endHour', value: 9, acknowledged: true },
                { relativeId: 'schedule.monday.p1.endMinute', value: 15, acknowledged: false },
            ]),
        ).to.deep.equal({
            parameter: 0x0077,
            value: Buffer.from([0x01, 0x01, 0x02, 0x00, 0x1e, 0x09]),
        });
    });
});
