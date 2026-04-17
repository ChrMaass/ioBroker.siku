import { expect } from 'chai';
import { buildPacket, parsePacket } from './siku-protocol';
import { SikuFunction } from './siku-constants';
import {
    buildWriteRequestForState,
    decodeMappedStateUpdates,
    getWritableStateDefinition,
    isButtonState,
} from './siku-state-mapping';

describe('SIKU state mappings', () => {
    it('decodes mapped sensor, timer and diagnostic states from one packet', () => {
        const packet = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([
                0x01, 0x01, 0x02, 0x02, 0x06, 0x01, 0x07, 0x02, 0x19, 0x37, 0x25, 0x42, 0x44, 0x15, 0xfe, 0x02, 0x4a,
                0x20, 0x03, 0xfe, 0x03, 0x0b, 0x1e, 0x2d, 0x01, 0xfe, 0x04, 0x64, 0x05, 0x02, 0x01, 0x00, 0xfe, 0x06,
                0x86, 0x01, 0x02, 0x03, 0x04, 0xea, 0x07, 0x83, 0x01, 0x88, 0x01, 0xff, 0x03, 0xfe, 0x02, 0x02, 0x0f,
                0x00, 0xfe, 0x02, 0x03, 0x1e, 0x00, 0x04, 0x01, 0x05, 0x00,
            ]),
        );

        const updates = decodeMappedStateUpdates(parsePacket(packet));
        const asMap = new Map(updates.map(update => [update.relativeId, update.value]));

        expect(asMap.get('control.power')).to.equal(true);
        expect(asMap.get('control.fanSpeed')).to.equal(2);
        expect(asMap.get('timers.boostActive')).to.equal(true);
        expect(asMap.get('control.timerMode')).to.equal(2);
        expect(asMap.get('control.humiditySetpoint')).to.equal(55);
        expect(asMap.get('sensors.humidity')).to.equal(66);
        expect(asMap.get('control.manualFanSpeed')).to.equal(21);
        expect(asMap.get('sensors.fan1Rpm')).to.equal(800);
        expect(asMap.get('timers.timerCountdownSeconds')).to.equal(6330);
        expect(asMap.get('timers.timerCountdownText')).to.equal('1h 45m 30s');
        expect(asMap.get('timers.filterCountdownMinutes')).to.equal(1565);
        expect(asMap.get('timers.filterCountdownText')).to.equal('1d 2h 5m');
        expect(asMap.get('info.firmwareVersion')).to.equal('1.2 (03.04.2026)');
        expect(asMap.get('diagnostics.alarmLevel')).to.equal(1);
        expect(asMap.get('diagnostics.filterChangeRequired')).to.equal(true);
        expect(asMap.get('timers.nightModeSetpointMinutes')).to.equal(15);
        expect(asMap.get('timers.partyModeSetpointMinutes')).to.equal(30);
        expect(asMap.get('sensors.humidityAboveSetpoint')).to.equal(true);
        expect(asMap.get('sensors.analogAboveSetpoint')).to.equal(false);
    });

    it('builds write requests for switch, timer and button states', () => {
        expect(buildWriteRequestForState('control.power', true)).to.deep.equal({
            parameter: 0x0001,
            value: Buffer.from([0x01]),
        });
        expect(buildWriteRequestForState('timers.partyModeSetpointMinutes', 125)).to.deep.equal({
            parameter: 0x0303,
            value: Buffer.from([5, 2]),
        });
        expect(buildWriteRequestForState('diagnostics.resetAlarms', true)).to.deep.equal({
            parameter: 0x0080,
            value: Buffer.from([0x01]),
        });
        expect(isButtonState('diagnostics.resetAlarms')).to.equal(true);
        expect(isButtonState('control.power')).to.equal(false);
        expect(getWritableStateDefinition('control.power')?.write?.parameter).to.equal(0x0001);
    });

    it('rejects invalid write values early', () => {
        expect(() => buildWriteRequestForState('control.humiditySetpoint', 30)).to.throw(
            'Humidity setpoint must be an integer between 40 and 80',
        );
        expect(() => buildWriteRequestForState('diagnostics.resetAlarms', false)).to.throw(
            'Button states only accept the value true',
        );
    });

    it('decodes live 4-byte filter countdown payloads without failing the poll cycle', () => {
        const packet = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([0xfe, 0x04, 0x64, 0x0c, 0x0f, 0xb7, 0x00]),
        );

        const updates = decodeMappedStateUpdates(parsePacket(packet));
        const asMap = new Map(updates.map(update => [update.relativeId, update.value]));

        expect(asMap.get('timers.filterCountdownMinutes')).to.equal(264432);
        expect(asMap.get('timers.filterCountdownText')).to.equal('183d 15h 12m');
    });
});
