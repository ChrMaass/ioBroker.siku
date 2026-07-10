import { expect } from 'chai';
import { SikuOperationCoordinator } from './siku-operation-queue';

describe('SIKU operation coordinator', () => {
    it('serializes global network operations in submission order', async () => {
        const coordinator = new SikuOperationCoordinator();
        const events: string[] = [];
        let releaseFirst: (() => void) | undefined;

        const first = coordinator.enqueueNetwork(async () => {
            events.push('first:start');
            await new Promise<void>(resolve => {
                releaseFirst = resolve;
            });
            events.push('first:end');
            return 1;
        });
        const second = coordinator.enqueueNetwork(() => {
            events.push('second:start');
            return Promise.resolve(2);
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(events).to.deep.equal(['first:start']);
        releaseFirst?.();
        expect(await Promise.all([first, second])).to.deep.equal([1, 2]);
        expect(events).to.deep.equal(['first:start', 'first:end', 'second:start']);
    });

    it('keeps device queues independent while preserving order per device', async () => {
        const coordinator = new SikuOperationCoordinator();
        const events: string[] = [];
        let releaseA: (() => void) | undefined;

        const firstA = coordinator.enqueueDevice('A', async () => {
            events.push('A1:start');
            await new Promise<void>(resolve => {
                releaseA = resolve;
            });
            events.push('A1:end');
        });
        const secondA = coordinator.enqueueDevice('A', () => {
            events.push('A2');
            return Promise.resolve();
        });
        const firstB = coordinator.enqueueDevice('B', () => {
            events.push('B1');
            return Promise.resolve();
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(events).to.include('A1:start');
        expect(events).to.include('B1');
        expect(events).to.not.include('A2');
        releaseA?.();
        await Promise.all([firstA, secondA, firstB]);
        expect(events.indexOf('A1:end')).to.be.lessThan(events.indexOf('A2'));
    });
});
