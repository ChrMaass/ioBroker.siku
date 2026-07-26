import { expect } from 'chai';
import {
    deviceObjectTreeHasCustomBindings,
    findOrphanedDeviceObjectIds,
    getDiscoveryPasswords,
    isAdminMessageOrigin,
} from './siku-runtime-safety';

describe('SIKU runtime safety helpers', () => {
    it('finds only complete stale device roots and leaves current or custom objects untouched', () => {
        const objects = {
            'siku.0.devices': { type: 'folder' },
            'siku.0.devices.001800354353530B': { type: 'device' },
            'siku.0.devices.001800354353530B.info': { type: 'channel' },
            'siku.0.devices.004500324353530B': { type: 'device' },
            'siku.0.devices.custom': { type: 'folder' },
        } as unknown as Record<string, ioBroker.Object>;

        expect(findOrphanedDeviceObjectIds('siku.0', objects, new Set(['001800354353530B']))).to.deep.equal([
            'devices.004500324353530B',
        ]);
    });

    it('uses every unique configured password for discovery unless one was supplied explicitly', () => {
        expect(
            getDiscoveryPasswords(undefined, {
                '001800354353530B': '1111',
                '004500324353530B': '2222',
                '0047002E4353530B': '1111',
            }),
        ).to.deep.equal(['1111', '2222']);
        expect(getDiscoveryPasswords('9999', { '001800354353530B': '1111' })).to.deep.equal(['9999']);

        const manyPasswords = Object.fromEntries(
            Array.from({ length: 20 }, (_, index) => [index.toString(16).padStart(16, '0'), `${index + 1}`]),
        );
        expect(getDiscoveryPasswords(undefined, manyPasswords)).to.have.length(16);
    });

    it('identifies the Admin UI origin used for configuration-update responses', () => {
        expect(isAdminMessageOrigin('system.adapter.admin.0')).to.equal(true);
        expect(isAdminMessageOrigin('system.adapter.javascript.0')).to.equal(false);
        expect(isAdminMessageOrigin(undefined)).to.equal(false);
    });

    it('detects custom history bindings anywhere below a stale device root', () => {
        const objects = {
            'siku.0.devices.004500324353530B': { type: 'device', common: { name: 'Old fan' } },
            'siku.0.devices.004500324353530B.sensors': { type: 'channel', common: { name: 'Sensors' } },
            'siku.0.devices.004500324353530B.sensors.humidity': {
                type: 'state',
                common: {
                    name: 'Humidity',
                    type: 'number',
                    role: 'value.humidity',
                    read: true,
                    write: false,
                    custom: {
                        'system.adapter.history.0': { enabled: true },
                    },
                },
                native: {},
            },
        } as unknown as Record<string, ioBroker.Object>;

        expect(deviceObjectTreeHasCustomBindings('siku.0', 'devices.004500324353530B', objects)).to.equal(true);
        expect(deviceObjectTreeHasCustomBindings('siku.0', 'devices.001800354353530B', objects)).to.equal(false);
    });
});
