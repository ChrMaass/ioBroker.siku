import { expect } from 'chai';
import {
    buildDevicePasswordRegistry,
    normalizeDevicePasswordRegistry,
    resolveConfiguredDevicePassword,
    serializeDevicePasswordRegistry,
    stripLegacyPasswordsFromDevices,
    prepareStoredDevicePasswords,
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

    it('accepts the schema-compliant password table format and serializes it deterministically', () => {
        expect(
            normalizeDevicePasswordRegistry([
                { id: '004500324353530b', password: ' 1111 ' },
                { id: 'broken', password: '9999' },
                { id: '001800354353530B', password: '1234' },
            ]),
        ).to.deep.equal({
            '001800354353530B': '1234',
            '004500324353530B': '1111',
        });

        expect(
            serializeDevicePasswordRegistry({
                '004500324353530B': '1111',
                '001800354353530B': '1234',
            }),
        ).to.deep.equal([
            { id: '001800354353530B', password: '1234' },
            { id: '004500324353530B', password: '1111' },
        ]);
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

    it('recovers legacy plaintext rows and persists every password encrypted', () => {
        const encryptedPrefix = '$/aes-192-cbc:';
        const result = prepareStoredDevicePasswords({
            configuredDevices: [
                { id: '001800354353530B', host: '192.168.55.46' },
                { id: '004500324353530B', host: '192.168.55.116' },
            ],
            decryptedRegistry: [
                { id: '001800354353530B', password: 'corrupted-runtime-value' },
                { id: '004500324353530B', password: '4321' },
            ],
            storedRegistry: [
                { id: '001800354353530B', password: '1111' },
                { id: '004500324353530B', password: `${encryptedPrefix}already-encrypted` },
            ],
            decrypt: value => (value.startsWith(encryptedPrefix) ? '4321' : `invalid:${value}`),
            encrypt: value => `${encryptedPrefix}${value}`,
        });

        expect(result.runtimeRegistry).to.deep.equal({
            '001800354353530B': '1111',
            '004500324353530B': '4321',
        });
        expect(result.storedRegistry).to.deep.equal([
            { id: '001800354353530B', password: `${encryptedPrefix}1111` },
            { id: '004500324353530B', password: `${encryptedPrefix}already-encrypted` },
        ]);
        expect(result.storageChanged).to.equal(true);
    });

    it('migrates legacy object registries and removes duplicate device rows', () => {
        const encryptedPrefix = '$/aes-192-cbc:';
        const result = prepareStoredDevicePasswords({
            configuredDevices: [
                { id: '001800354353530B', host: '192.168.55.46' },
                { id: '001800354353530B', host: '192.168.55.46' },
            ],
            decryptedRegistry: {},
            storedRegistry: { '001800354353530B': { password: '1111' } },
            decrypt: value => value,
            encrypt: value => `${encryptedPrefix}${value}`,
        });

        expect(result.runtimeRegistry).to.deep.equal({ '001800354353530B': '1111' });
        expect(result.storedRegistry).to.deep.equal([{ id: '001800354353530B', password: `${encryptedPrefix}1111` }]);
        expect(result.storageChanged).to.equal(true);
    });

    it('rejects passwords outside the protocol character set', () => {
        expect(() =>
            prepareStoredDevicePasswords({
                configuredDevices: [{ id: '001800354353530B', host: '192.168.55.46' }],
                decryptedRegistry: [{ id: '001800354353530B', password: 'bad-value!' }],
                storedRegistry: [{ id: '001800354353530B', password: 'bad-value!' }],
                decrypt: () => 'still-bad!',
                encrypt: value => value,
            }),
        ).to.throw('No usable password found for device 001800354353530B');
    });
});
