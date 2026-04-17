import { expect } from 'chai';
import { formatDiscoveredType, mergeDiscoveredDevicesIntoConfig } from './siku-discovery-config';

describe('SIKU discovery config helpers', () => {
    it('formats discovered type information in a readable way', () => {
        expect(formatDiscoveredType({ deviceTypeCode: 14, deviceTypeHex: '0E00' })).to.equal('0E00 (14)');
        expect(formatDiscoveredType({ deviceTypeCode: 14, deviceTypeHex: null })).to.equal('14');
        expect(formatDiscoveredType({ deviceTypeCode: null, deviceTypeHex: '0E00' })).to.equal('0E00');
        expect(formatDiscoveredType({ deviceTypeCode: null, deviceTypeHex: null })).to.equal('');
    });

    it('upserts discovered devices into the current config without losing manual settings', () => {
        expect(
            mergeDiscoveredDevicesIntoConfig(
                [
                    {
                        id: '001800354353530B',
                        host: '192.168.55.10',
                        name: 'Wohnzimmer',
                        password: '1234',
                        enabled: false,
                        discoveredType: 'legacy',
                        lastSeen: '2026-04-17T01:00:00.000Z',
                    },
                    {
                        id: '0047002E4353530B',
                        host: '192.168.55.185',
                        name: 'Schlafzimmer?',
                        password: '1111',
                        enabled: true,
                        discoveredType: '0E00 (14)',
                        lastSeen: '2026-04-17T01:05:00.000Z',
                    },
                ],
                [
                    {
                        host: '192.168.55.46',
                        port: 4000,
                        deviceId: '001800354353530B',
                        deviceTypeCode: 14,
                        deviceTypeHex: '0E00',
                        receivedAt: '2026-04-17T02:00:00.000Z',
                    },
                    {
                        host: '192.168.55.116',
                        port: 4000,
                        deviceId: '004500324353530B',
                        deviceTypeCode: 14,
                        deviceTypeHex: '0E00',
                        receivedAt: '2026-04-17T02:00:01.000Z',
                    },
                ],
            ),
        ).to.deep.equal([
            {
                id: '001800354353530B',
                host: '192.168.55.46',
                name: 'Wohnzimmer',
                password: '1234',
                enabled: false,
                discoveredType: '0E00 (14)',
                lastSeen: '2026-04-17T02:00:00.000Z',
            },
            {
                id: '0047002E4353530B',
                host: '192.168.55.185',
                name: 'Schlafzimmer?',
                password: '1111',
                enabled: true,
                discoveredType: '0E00 (14)',
                lastSeen: '2026-04-17T01:05:00.000Z',
            },
            {
                id: '004500324353530B',
                host: '192.168.55.116',
                name: 'Lüfter 530B',
                password: '1111',
                enabled: true,
                discoveredType: '0E00 (14)',
                lastSeen: '2026-04-17T02:00:01.000Z',
            },
        ]);
    });
});
