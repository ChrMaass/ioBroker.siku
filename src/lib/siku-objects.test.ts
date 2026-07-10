import { expect } from 'chai';
import { ensureSikuDeviceObjects } from './siku-objects';
import type { SikuRuntimeDeviceConfig } from './siku-runtime';

describe('SIKU object factory', () => {
    it('creates device, channels and localized states in hierarchy order', async () => {
        const objects: Array<{ id: string; object: ioBroker.SettableObject }> = [];
        const adapter = {
            extendObjectAsync: (id: string, object: ioBroker.SettableObject) => {
                objects.push({ id, object });
                return Promise.resolve({ id, value: object } as never);
            },
        };
        const device: SikuRuntimeDeviceConfig = {
            id: '001800354353530B',
            host: '192.168.55.46',
            name: 'Living room',
            password: '1111',
            enabled: true,
            discoveredType: '0E00 (14)',
            lastSeen: '',
            objectId: 'devices.001800354353530B',
        };

        await ensureSikuDeviceObjects(adapter, device, 'de');

        expect(objects[0]).to.deep.include({ id: device.objectId });
        expect(objects[0].object.type).to.equal('device');
        const firstState = objects.findIndex(entry => entry.object.type === 'state');
        const lastChannel = objects.map(entry => entry.object.type).lastIndexOf('channel');
        expect(firstState).to.be.greaterThan(lastChannel);
        const fanSpeedObject = objects.find(entry => entry.id.endsWith('.control.fanSpeed'))?.object;
        expect((fanSpeedObject?.common as ioBroker.StateCommon | undefined)?.states).to.deep.equal({
            1: 'Stufe 1',
            2: 'Stufe 2',
            3: 'Stufe 3',
            255: 'Manuelle Stufe',
        });
        const fanSpeedTextObject = objects.find(entry => entry.id.endsWith('.control.fanSpeedText'))?.object;
        expect(fanSpeedTextObject).to.deep.include({
            type: 'state',
            common: {
                name: 'Fan speed (text)',
                role: 'text',
                type: 'string',
                read: true,
                write: false,
                def: '',
            },
        });
        expect(objects.some(entry => entry.id.endsWith('.diagnostics.lastScheduleReadLocal'))).to.equal(true);
    });
});
