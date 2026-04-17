import { expect } from 'chai';
import { decodeIPv4Address, decodePollSnapshot, normalizeConfiguredDevice } from './siku-runtime';
import { buildPacket, parsePacket } from './siku-protocol';
import { SikuFunction } from './siku-constants';

describe('SIKU runtime helpers', () => {
    it('normalizes configured devices with sane defaults', () => {
        expect(
            normalizeConfiguredDevice(
                {
                    id: '001800354353530b',
                    host: '192.168.55.46',
                    name: '  Gästezimmer  ',
                    password: '',
                    enabled: true,
                    discoveredType: ' 014 ',
                    lastSeen: '2026-04-17T01:00:00.000Z',
                },
                0,
            ),
        ).to.deep.equal({
            id: '001800354353530B',
            host: '192.168.55.46',
            name: 'Gästezimmer',
            password: '1111',
            enabled: true,
            discoveredType: '014',
            lastSeen: '2026-04-17T01:00:00.000Z',
            objectId: 'devices.001800354353530B',
        });
    });

    it('rejects malformed configured devices early', () => {
        expect(() => normalizeConfiguredDevice({ host: '192.168.55.46' }, 0)).to.throw(
            'devices[0].id must be a non-empty string',
        );
        expect(() =>
            normalizeConfiguredDevice(
                {
                    id: '00180035.353530B',
                    host: '192.168.55.46',
                },
                0,
            ),
        ).to.throw('devices[0].id must only contain hexadecimal characters');
        expect(() =>
            normalizeConfiguredDevice(
                {
                    id: '00180035435353GB',
                    host: '192.168.55.46',
                },
                0,
            ),
        ).to.throw('devices[0].id must only contain hexadecimal characters');
        expect(() =>
            normalizeConfiguredDevice(
                {
                    id: '001800354353530B',
                    host: 'fan.local',
                },
                0,
            ),
        ).to.throw('devices[0].host must be an IPv4 address');
        expect(() =>
            normalizeConfiguredDevice(
                {
                    id: '001800354353530B',
                    host: '192.168.55.46',
                    enabled: 'false' as unknown as boolean,
                },
                0,
            ),
        ).to.throw('devices[0].enabled must be a boolean');
        expect(() =>
            normalizeConfiguredDevice(
                {
                    id: '001800354353530B',
                    host: '192.168.55.46',
                    password: '123456789',
                },
                0,
            ),
        ).to.throw('devices[0].password must be at most 8 characters long');
    });

    it('decodes IPv4 values when the payload length is correct', () => {
        expect(decodeIPv4Address(Buffer.from([192, 168, 55, 46]))).to.equal('192.168.55.46');
        expect(decodeIPv4Address(Buffer.from([192, 168, 55]))).to.equal(null);
    });

    it('decodes the core poll snapshot from a response packet', () => {
        const packet = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([
                0x01,
                0x01,
                0x02,
                0x02,
                0xfe,
                0x04,
                0xa3,
                0xc0,
                0xa8,
                0x37,
                0x2e,
                0xfe,
                0x02,
                0xb9,
                0x0e,
                0x00,
                0xfe,
                0x10,
                0x7c,
                ...Buffer.from('001800354353530B', 'ascii'),
            ]),
        );

        expect(
            decodePollSnapshot('001800354353530B', parsePacket(packet), new Date('2026-04-17T01:00:00.000Z')),
        ).to.deep.equal({
            reportedDeviceId: '001800354353530B',
            power: true,
            fanSpeed: 2,
            deviceTypeCode: 14,
            deviceTypeHex: '0E00',
            ipAddress: '192.168.55.46',
            lastSeen: '2026-04-17T01:00:00.000Z',
        });
    });

    it('rejects poll snapshots when the configured and reported device ids differ', () => {
        const packet = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([0xfe, 0x10, 0x7c, ...Buffer.from('001800354353530B', 'ascii')]),
        );

        expect(() => decodePollSnapshot('004500324353530B', parsePacket(packet))).to.throw(
            'Configured device ID 004500324353530B does not match response device ID 001800354353530B',
        );
    });
});
