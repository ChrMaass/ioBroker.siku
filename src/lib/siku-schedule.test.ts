import { expect } from 'chai';
import { SikuFunction } from './siku-constants';
import { buildPacket, parsePacket } from './siku-protocol';
import {
    buildScheduleReadRequests,
    buildScheduleWriteRequest,
    decodeScheduleUpdates,
    getScheduleSnapshotStateIds,
    getScheduleStateDefinition,
    isScheduleStateId,
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
});
