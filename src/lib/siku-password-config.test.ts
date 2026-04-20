import { expect } from 'chai';
import {
    buildDevicePasswordRegistry,
    normalizeDevicePasswordRegistry,
    resolveConfiguredDevicePassword,
    stripLegacyPasswordsFromDevices,
} from './siku-password-config';

describe('SIKU password config helpers', () => {
    it('normalizes the dedicated password registry and ignores malformed leftovers', () => {
        expect(
            normalizeDevicePasswordRegistry({
                '001800354353530b': ' 1234 ',
                '004500324353530B': { password: '1111' },
                broken: '9999',
                '0047002E4353530B': '',
            }),
        ).to.deep.equal({
            '001800354353530B': '1234',
            '004500324353530B': '1111',
        });
    });

    it('prefers the dedicated registry over legacy inline passwords', () => {
        expect(
            resolveConfiguredDevicePassword(
                {
                    id: '001800354353530B',
                    password: '1111',
                },
                0,
                {
                    '001800354353530B': '4321',
                },
            ),
        ).to.equal('4321');
    });

    it('builds a clean password registry for all configured devices and strips legacy fields', () => {
        const devices: ioBroker.SikuDeviceConfig[] = [
            {
                id: '001800354353530B',
                host: '192.168.55.46',
                name: 'Wohnzimmer',
                password: '1234',
                enabled: true,
                discoveredType: '0E00 (14)',
                lastSeen: '2026-04-17T02:00:00.000Z',
            },
            {
                id: '004500324353530B',
                host: '192.168.55.116',
                name: 'Bad',
                password: '',
                enabled: true,
                discoveredType: '',
                lastSeen: '',
            },
        ];

        expect(
            buildDevicePasswordRegistry(devices, {
                '001800354353530B': '4321',
            }),
        ).to.deep.equal({
            '001800354353530B': '4321',
            '004500324353530B': '1111',
        });

        expect(stripLegacyPasswordsFromDevices(devices)).to.deep.equal([
            {
                id: '001800354353530B',
                host: '192.168.55.46',
                name: 'Wohnzimmer',
                enabled: true,
                discoveredType: '0E00 (14)',
                lastSeen: '2026-04-17T02:00:00.000Z',
            },
            {
                id: '004500324353530B',
                host: '192.168.55.116',
                name: 'Bad',
                enabled: true,
                discoveredType: '',
                lastSeen: '',
            },
        ]);
    });
});
