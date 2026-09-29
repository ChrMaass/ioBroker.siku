import { EventEmitter } from 'node:events';
import { expect } from 'chai';
import type { SikuRuntimeDeviceConfig } from './lib/siku-runtime';

interface ModuleLoader {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

interface FakeAdapterOptions {
    name?: string;
    config?: Partial<ioBroker.AdapterConfig>;
}

class FakeAdapter extends EventEmitter {
    public readonly namespace = 'siku.0';
    public readonly language = 'en';
    public readonly name: string;
    public readonly config: ioBroker.AdapterConfig;
    public readonly log = {
        debug: (_message: string): void => undefined,
        info: (_message: string): void => undefined,
        warn: (_message: string): void => undefined,
        error: (_message: string): void => undefined,
    };

    public constructor(options: FakeAdapterOptions = {}) {
        super();
        this.name = options.name ?? 'siku';
        this.config = {
            pollIntervalSec: 30,
            discoveryBroadcastAddress: '255.255.255.255',
            timeCheckIntervalHours: 24,
            timeSyncThresholdSec: 10,
            devices: [],
            devicePasswords: [],
            ...options.config,
        };
    }

    public setTimeout(callback: () => void, delay: number): ioBroker.Timeout {
        return setTimeout(callback, delay) as unknown as ioBroker.Timeout;
    }

    public clearTimeout(handle: ioBroker.Timeout): void {
        clearTimeout(handle as unknown as NodeJS.Timeout);
    }

    public setInterval(callback: () => void, delay: number): ioBroker.Interval {
        return setInterval(callback, delay) as unknown as ioBroker.Interval;
    }

    public clearInterval(handle: ioBroker.Interval): void {
        clearInterval(handle as unknown as NodeJS.Timeout);
    }
}

// main.ts intentionally exports the compact-mode factory via CommonJS. Replace adapter-core
// before loading it so lifecycle orchestration can be tested without a running ioBroker host.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const moduleLoader = require('node:module') as ModuleLoader;
const originalLoad = moduleLoader._load;
moduleLoader._load = (request, parent, isMain) =>
    request === '@iobroker/adapter-core'
        ? { Adapter: FakeAdapter, EXIT_CODES: { START_IMMEDIATELY_AFTER_STOP: 12 } }
        : originalLoad(request, parent, isMain);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createAdapter = require('./main') as (options?: FakeAdapterOptions) => unknown;
moduleLoader._load = originalLoad;

function createRuntimeDevice(id = '001800354353530B'): SikuRuntimeDeviceConfig {
    return {
        id,
        host: '192.168.55.46',
        name: 'Test fan',
        password: '1111',
        enabled: true,
        discoveredType: '',
        lastSeen: '',
        objectId: `devices.${id}`,
    };
}

describe('SIKU main lifecycle orchestration', () => {
    it('applies a busy backoff instead of scheduling an overdue RTC check at zero milliseconds', async () => {
        const adapter = createAdapter() as {
            runtimeDevices: Map<string, SikuRuntimeDeviceConfig>;
            getStateAsync: (id: string) => Promise<ioBroker.State | null>;
            setTimeout: (callback: () => void, delay: number) => ioBroker.Timeout;
            startTimeCheckScheduler: (minimumDelayMs?: number) => Promise<void>;
        };
        adapter.runtimeDevices.set('001800354353530B', createRuntimeDevice());
        adapter.getStateAsync = () => Promise.resolve(null);
        let scheduledDelay: number | undefined;
        adapter.setTimeout = (_callback, delay) => {
            scheduledDelay = delay;
            return 1 as unknown as ioBroker.Timeout;
        };

        await adapter.startTimeCheckScheduler(60_000);

        expect(scheduledDelay).to.equal(60_000);
    });

    it('reschedules a skipped concurrent time check with the one-minute backoff', async () => {
        const adapter = createAdapter() as {
            runTimeChecks: () => Promise<{ skippedBecauseBusy: boolean; failed: number }>;
            startTimeCheckScheduler: (minimumDelayMs?: number) => Promise<void>;
            executeScheduledTimeCheck: () => Promise<void>;
        };
        adapter.runTimeChecks = () => Promise.resolve({ skippedBecauseBusy: true, failed: 0 });
        let observedMinimumDelay: number | undefined;
        adapter.startTimeCheckScheduler = minimumDelayMs => {
            observedMinimumDelay = minimumDelayMs;
            return Promise.resolve();
        };

        await adapter.executeScheduledTimeCheck();

        expect(observedMinimumDelay).to.equal(60_000);
    });

    it('reschedules a failed time check with the one-minute backoff', async () => {
        const adapter = createAdapter() as {
            runTimeChecks: () => Promise<{ skippedBecauseBusy: boolean; failed: number }>;
            startTimeCheckScheduler: (minimumDelayMs?: number) => Promise<void>;
            executeScheduledTimeCheck: () => Promise<void>;
        };
        adapter.runTimeChecks = () => Promise.resolve({ skippedBecauseBusy: false, failed: 1 });
        let observedMinimumDelay: number | undefined;
        adapter.startTimeCheckScheduler = minimumDelayMs => {
            observedMinimumDelay = minimumDelayMs;
            return Promise.resolve();
        };

        await adapter.executeScheduledTimeCheck();

        expect(observedMinimumDelay).to.equal(60_000);
    });

    it('builds schedule writes from confirmed states and tracked adjacent UI changes', async () => {
        const adapter = createAdapter() as {
            namespace: string;
            getStateAsync: (id: string) => Promise<ioBroker.State | null>;
            registerPendingScheduleWrite: (deviceId: string, relativeId: string, value: ioBroker.StateValue) => void;
            buildScheduleWriteRequestForState: (
                deviceId: string,
                fullStateId: string,
                relativeId: string,
                value: ioBroker.StateValue,
            ) => Promise<{ parameter: number; value: Buffer }>;
        };
        adapter.getStateAsync = id =>
            Promise.resolve({
                val: id.endsWith('.speed') ? 2 : id.endsWith('.endHour') ? 8 : 15,
                ack: id.endsWith('.endHour'),
                ts: 0,
                q: 0,
                from: 'system.adapter.siku.0',
                lc: 0,
            });
        adapter.registerPendingScheduleWrite('001800354353530B', 'schedule.monday.p1.speed', 2);

        const request = await adapter.buildScheduleWriteRequestForState(
            '001800354353530B',
            'siku.0.devices.001800354353530B.schedule.monday.p1.endMinute',
            'schedule.monday.p1.endMinute',
            30,
        );

        expect(request).to.deep.equal({
            parameter: 0x0077,
            value: Buffer.from([0x01, 0x01, 0x02, 0x00, 0x1e, 0x08]),
        });
    });

    it('removes only stale configured-device object roots', async () => {
        const adapter = createAdapter({
            config: {
                devices: [
                    {
                        id: '001800354353530B',
                        host: '192.168.55.46',
                        name: 'Current',
                        enabled: true,
                        discoveredType: '',
                        lastSeen: '',
                    },
                ],
            },
        }) as {
            getAdapterObjectsAsync: () => Promise<Record<string, ioBroker.Object>>;
            delObjectAsync: (id: string, options: { recursive: boolean }) => Promise<void>;
            cleanupOrphanedDeviceObjects: () => Promise<void>;
        };
        adapter.getAdapterObjectsAsync = () =>
            Promise.resolve({
                'siku.0.devices.001800354353530B': { type: 'device' } as ioBroker.DeviceObject,
                'siku.0.devices.004500324353530B': { type: 'device' } as ioBroker.DeviceObject,
            });
        const deleted: string[] = [];
        adapter.delObjectAsync = id => {
            deleted.push(id);
            return Promise.resolve();
        };

        await adapter.cleanupOrphanedDeviceObjects();

        expect(deleted).to.deep.equal(['devices.004500324353530B']);
    });

    it('preserves stale device trees with custom bindings and all trees for an empty config', async () => {
        const staleRoot = 'siku.0.devices.004500324353530B';
        const adapter = createAdapter({
            config: {
                devices: [
                    {
                        id: '001800354353530B',
                        host: '192.168.55.46',
                        name: 'Current',
                        enabled: true,
                        discoveredType: '',
                        lastSeen: '',
                    },
                ],
            },
        }) as {
            config: ioBroker.AdapterConfig;
            getAdapterObjectsAsync: () => Promise<Record<string, ioBroker.Object>>;
            delObjectAsync: (id: string, options: { recursive: boolean }) => Promise<void>;
            cleanupOrphanedDeviceObjects: () => Promise<void>;
        };
        adapter.getAdapterObjectsAsync = () =>
            Promise.resolve({
                [staleRoot]: { type: 'device', common: { name: 'Old fan' }, native: {} },
                [`${staleRoot}.info.connection`]: {
                    type: 'state',
                    common: {
                        name: 'Connection',
                        type: 'boolean',
                        role: 'indicator.connected',
                        read: true,
                        write: false,
                        custom: { 'system.adapter.history.0': { enabled: true } },
                    },
                    native: {},
                },
            } as unknown as Record<string, ioBroker.Object>);
        const deleted: string[] = [];
        adapter.delObjectAsync = id => {
            deleted.push(id);
            return Promise.resolve();
        };

        await adapter.cleanupOrphanedDeviceObjects();
        adapter.config.devices = [];
        await adapter.cleanupOrphanedDeviceObjects();

        expect(deleted).to.deep.equal([]);
    });

    it('treats stale-object cleanup as best-effort startup maintenance', async () => {
        const adapter = createAdapter() as {
            log: { warn: (message: string) => void };
            extendObjectAsync: () => Promise<void>;
            cleanupOrphanedDeviceObjects: () => Promise<void>;
            initializeRuntimeDevices: () => Promise<void>;
        };
        adapter.extendObjectAsync = () => Promise.resolve();
        adapter.cleanupOrphanedDeviceObjects = () => Promise.reject(new Error('object is locked'));
        let warning = '';
        adapter.log.warn = message => {
            warning = message;
        };

        await adapter.initializeRuntimeDevices();

        expect(warning).to.equal('Stale device object cleanup failed: object is locked');
    });

    it('does not mutate runtime config for discovery calls outside the Admin UI', async () => {
        const adapter = createAdapter() as {
            enqueueNetworkOperation: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>;
            applyDiscoveryResults: (devices: unknown[]) => Promise<void>;
            sendMessageResponse: (obj: ioBroker.Message, response: Record<string, unknown>) => void;
            handleDiscoverMessage: (obj: ioBroker.Message) => Promise<void>;
        };
        adapter.enqueueNetworkOperation = () =>
            Promise.resolve([
                {
                    host: '192.168.55.46',
                    port: 4000,
                    deviceId: '001800354353530B',
                    deviceTypeCode: 14,
                    deviceTypeHex: '0E00',
                    receivedAt: '2026-07-26T00:00:00.000Z',
                },
            ]) as Promise<never>;
        let runtimeMutationCalled = false;
        adapter.applyDiscoveryResults = () => {
            runtimeMutationCalled = true;
            return Promise.resolve();
        };
        let response: Record<string, unknown> | undefined;
        adapter.sendMessageResponse = (_obj, messageResponse) => {
            response = messageResponse;
        };

        await adapter.handleDiscoverMessage({
            command: 'discover',
            message: {},
            from: 'system.adapter.javascript.0',
        } as ioBroker.Message);

        expect(runtimeMutationCalled).to.equal(false);
        expect(response?.result).to.equal('discoveryFoundNotSaved');
        expect(response).not.to.have.property('native');
        expect(response).not.to.have.property('saveConfig');
    });

    it('aborts outstanding operations before completing unload', () => {
        const adapter = createAdapter() as {
            shutdownController: AbortController;
            unloading: boolean;
            onUnload: (callback: () => void) => void;
        };
        let callbackCalled = false;

        adapter.onUnload(() => {
            callbackCalled = true;
        });

        expect(adapter.unloading).to.equal(true);
        expect(adapter.shutdownController.signal.aborted).to.equal(true);
        expect(callbackCalled).to.equal(true);
    });

    it('limits diagnostic error values to the configured state-safe size', () => {
        const adapter = createAdapter() as {
            limitDiagnosticError: (message: string) => string;
        };

        expect(adapter.limitDiagnosticError('x'.repeat(2_000))).to.have.length(1_024);
    });

    it('terminates for an immediate restart after a contained startup failure', async () => {
        const adapter = createAdapter() as {
            log: { error: (message: string) => void };
            setState: () => Promise<void>;
            terminate: (reason?: string, exitCode?: number) => never;
            onReady: () => Promise<void>;
        };
        adapter.setState = () => Promise.reject(new Error('states database unavailable'));
        let loggedError = '';
        let termination: { reason?: string; exitCode?: number } | undefined;
        adapter.log.error = message => {
            loggedError = message;
        };
        adapter.terminate = (reason, exitCode) => {
            termination = { reason, exitCode };
            return undefined as never;
        };

        await adapter.onReady();

        expect(loggedError).to.equal('Adapter startup failed: states database unavailable');
        expect(termination).to.deep.equal({
            reason: 'Adapter startup failed: states database unavailable',
            exitCode: 12,
        });
    });
});
