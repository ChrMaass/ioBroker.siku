import { expect } from 'chai';
import {
    normalizeDiscoverMessagePayload,
    normalizeReadDeviceMessagePayload,
    normalizeSyncTimeDeviceMessagePayload,
} from './siku-message-validation';

describe('SIKU message payload validation', () => {
    it('normalizes a valid discover payload', () => {
        expect(
            normalizeDiscoverMessagePayload({
                broadcastAddress: '255.255.255.255',
                password: '1111',
                timeoutMs: 1_500,
                preferredBindPort: 4_000,
            }),
        ).to.deep.equal({
            broadcastAddress: '255.255.255.255',
            password: '1111',
            timeoutMs: 1_500,
            preferredBindPort: 4_000,
        });
    });

    it('rejects invalid discover payload field types early', () => {
        expect(() => normalizeDiscoverMessagePayload({ timeoutMs: '1500' })).to.throw(
            'timeoutMs must be an integer between 1 and 9007199254740991',
        );
    });

    it('normalizes a valid readDevice payload', () => {
        expect(
            normalizeReadDeviceMessagePayload({
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                port: 4_000,
                timeoutMs: 2_500,
                parameters: [1, { parameter: 0x0077, requestValue: [0x01, 0x01] }],
            }),
        ).to.deep.equal({
            host: '192.168.55.46',
            deviceId: '001800354353530B',
            password: '1111',
            port: 4_000,
            timeoutMs: 2_500,
            parameters: [1, { parameter: 0x0077, requestValue: [0x01, 0x01] }],
        });
    });

    it('normalizes a valid syncTimeDevice payload', () => {
        expect(normalizeSyncTimeDeviceMessagePayload({ deviceId: '001800354353530b' })).to.deep.equal({
            deviceId: '001800354353530B',
        });
    });

    it('rejects invalid readDevice payload fields early', () => {
        expect(() =>
            normalizeReadDeviceMessagePayload({
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                port: '4000',
                parameters: [1],
            }),
        ).to.throw('port must be an integer between 1 and 65535');
    });

    it('rejects malformed discovery, read or sync payload objects', () => {
        expect(() => normalizeDiscoverMessagePayload(null)).to.throw('discover requires an object payload');
        expect(() => normalizeReadDeviceMessagePayload({ host: '192.168.55.46' })).to.throw(
            'parameters must be an array',
        );
        expect(() => normalizeSyncTimeDeviceMessagePayload({})).to.throw('deviceId is required');
    });
});
