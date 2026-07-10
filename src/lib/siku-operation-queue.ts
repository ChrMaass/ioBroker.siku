/**
 * Coordinates device and UDP operations without coupling queue mechanics to the adapter lifecycle.
 *
 * SIKU devices reliably answer only when requests use the shared local UDP port 4000. Network
 * operations therefore have to be serialized globally, while non-network work can still be
 * serialized independently per device.
 */
export class SikuOperationCoordinator {
    private readonly deviceQueues = new Map<string, Promise<void>>();
    private networkQueue: Promise<void> = Promise.resolve();

    public async enqueueDevice<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.deviceQueues.get(deviceId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        const tracked = next.then(
            () => undefined,
            () => undefined,
        );

        this.deviceQueues.set(deviceId, tracked);
        void tracked.finally(() => {
            if (this.deviceQueues.get(deviceId) === tracked) {
                this.deviceQueues.delete(deviceId);
            }
        });

        return next;
    }

    public async enqueueNetwork<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.networkQueue;
        const next = previous.catch(() => undefined).then(operation);
        const tracked = next.then(
            () => undefined,
            () => undefined,
        );

        this.networkQueue = tracked;
        void tracked.finally(() => {
            if (this.networkQueue === tracked) {
                this.networkQueue = Promise.resolve();
            }
        });

        return next;
    }
}
