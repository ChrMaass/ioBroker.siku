/*
 * Created with @iobroker/create-adapter v3.1.2
 */

import * as utils from '@iobroker/adapter-core';
import { mergeDiscoveredDevicesIntoConfig, formatDiscoveredType } from './lib/siku-discovery-config';
import {
    SIKU_DEFAULT_PASSWORD,
    SIKU_PARAMETER_RTC_CALENDAR,
    SIKU_PARAMETER_RTC_TIME,
    SIKU_RUNTIME_POLL_PARAMETERS,
    SIKU_TIME_CHECK_PARAMETERS,
} from './lib/siku-constants';
import {
    normalizeDiscoverMessagePayload,
    normalizeReadDeviceMessagePayload,
    normalizeSyncTimeDeviceMessagePayload,
} from './lib/siku-message-validation';
import { discoverDevices, readDevicePacket, writeDevicePacket } from './lib/siku-network';
import {
    buildScheduleReadRequests,
    buildScheduleWriteRequest,
    decodeScheduleUpdates,
    getScheduleDayDefinitions,
    getScheduleSnapshotStateIds,
    getScheduleStateDefinitions,
    isScheduleStateId,
    SIKU_SCHEDULE_WRITABLE_STATE_IDS,
} from './lib/siku-schedule';
import {
    buildWriteRequestForState,
    decodeMappedStateUpdates,
    getStateDefinitionsByChannel,
    isButtonState,
    SIKU_POLL_PARAMETERS,
    SIKU_WRITABLE_STATE_IDS,
} from './lib/siku-state-mapping';
import { toHex } from './lib/siku-protocol';
import { calculateClockDriftSeconds, decodeRtcSnapshot, encodeRtcCalendar, encodeRtcTime } from './lib/siku-time';
import { decodePollSnapshot, normalizeConfiguredDevice } from './lib/siku-runtime';
import type { SikuDiscoveredDevice } from './lib/siku-network';
import type { ParsedSikuPacket, SikuReadRequestEntry } from './lib/siku-protocol';
import type { SikuDevicePollSnapshot, SikuRuntimeDeviceConfig } from './lib/siku-runtime';

type SikuPollTrigger = 'startup' | 'interval';
type SikuTimeCheckTrigger = 'interval' | 'manual';

interface ApplyConfiguredMetadataOptions {
    resetConnectionState?: boolean;
}

interface TimeCheckDeviceResult {
    deviceId: string;
    host: string;
    checked: boolean;
    synced: boolean;
    failed: boolean;
    skipped: boolean;
    driftSec: number | null;
    reason: 'synced' | 'withinThreshold' | 'disabled' | 'busy' | 'error';
    checkedAt: string | null;
    syncedAt: string | null;
    error?: string;
}

interface TimeCheckSummary {
    trigger: SikuTimeCheckTrigger;
    total: number;
    checked: number;
    synced: number;
    failed: number;
    skipped: number;
    skippedBecauseBusy: boolean;
    devices: TimeCheckDeviceResult[];
}

class Siku extends utils.Adapter {
    private readonly runtimeDevices = new Map<string, SikuRuntimeDeviceConfig>();
    private readonly deviceOperationQueues = new Map<string, Promise<unknown>>();
    private networkOperationQueue: Promise<void> = Promise.resolve();
    private pollCycleRunning = false;
    private timeCheckRunning = false;
    private pollIntervalHandle: ioBroker.Interval | undefined;
    private timeCheckIntervalHandle: ioBroker.Interval | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'siku',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', obj => {
            void this.onMessage(obj);
        });
        this.on('stateChange', (id, state) => {
            void this.onStateChange(id, state);
        });
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);

        this.log.info('Starte SIKU-Adapter mit Multi-Device-Runtime');
        this.logSafeConfig();

        await this.initializeRuntimeDevices();
        await this.subscribeWritableStates();
        await this.pollDevices('startup');
        this.startPolling();
        this.startTimeCheckScheduler();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            this.clearPollingTimer();
            this.clearTimeCheckTimer();
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }

    /**
     * Handles adapter messages from the admin UI or other instances.
     *
     * @param obj - The incoming ioBroker message object
     */
    private async onMessage(obj: ioBroker.Message | null | undefined): Promise<void> {
        if (!obj || typeof obj !== 'object' || !('command' in obj) || !obj.command) {
            return;
        }

        try {
            switch (obj.command) {
                case 'discover':
                    await this.handleDiscoverMessage(obj);
                    break;

                case 'readDevice':
                    await this.handleReadDeviceMessage(obj);
                    break;

                case 'syncTimeAll':
                    await this.handleSyncTimeAllMessage(obj);
                    break;

                case 'syncTimeDevice':
                    await this.handleSyncTimeDeviceMessage(obj);
                    break;

                default:
                    this.sendMessageResponse(obj, {
                        ok: false,
                        error: `Unknown command: ${obj.command}`,
                    });
                    break;
            }
        } catch (error) {
            const message = (error as Error).message;
            this.log.error(`Fehler bei Nachricht ${obj.command}: ${message}`);
            this.sendMessageResponse(obj, { ok: false, error: message });
        }
    }

    /**
     * Handles write requests to writable ioBroker states and forwards them to the device.
     *
     * @param id - Full ioBroker state id
     * @param state - New state value
     */
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state || state.ack || !id.startsWith(`${this.namespace}.devices.`)) {
            return;
        }

        const resolved = this.resolveWritableState(id);
        if (!resolved) {
            return;
        }

        const { device, relativeId, fullStateId } = resolved;

        try {
            await this.enqueueDeviceOperation(device.id, async () => {
                const request = isScheduleStateId(relativeId)
                    ? await this.buildScheduleWriteRequestForState(fullStateId, relativeId, state.val)
                    : buildWriteRequestForState(relativeId, state.val);
                const responsePacket = await this.enqueueNetworkOperation(() =>
                    writeDevicePacket({
                        host: device.host,
                        deviceId: device.id,
                        password: device.password,
                        parameters: [request],
                    }),
                );

                const mappedUpdates = decodeMappedStateUpdates(responsePacket);
                const scheduleUpdates = decodeScheduleUpdates(responsePacket);

                await this.applyMappedStateUpdates(device, mappedUpdates);
                await this.applyMappedStateUpdates(device, scheduleUpdates);
                await this.setStateChangedAsync(`${device.objectId}.diagnostics.lastError`, '', true);

                if (isScheduleStateId(relativeId)) {
                    return;
                }

                if (isButtonState(relativeId)) {
                    await this.setStateChangedAsync(fullStateId, false, true);
                }
            });

            this.log.info(`Schreibzugriff erfolgreich: ${device.id} -> ${relativeId} = ${JSON.stringify(state.val)}`);
        } catch (error) {
            const message = (error as Error).message;
            await this.setStateChangedAsync(`${device.objectId}.diagnostics.lastError`, `Schreiben: ${message}`, true);
            this.log.warn(`Schreibzugriff fehlgeschlagen für ${device.id} (${relativeId}): ${message}`);
        }
    }

    /**
     * Performs a network discovery using UDP broadcast, updates matching runtime devices
     * and returns a merged native config payload for the admin UI.
     *
     * @param obj - The original ioBroker message
     */
    private async handleDiscoverMessage(obj: ioBroker.Message): Promise<void> {
        const payload = normalizeDiscoverMessagePayload(obj.message ?? {});
        const devices = await this.enqueueNetworkOperation(() =>
            discoverDevices({
                broadcastAddress: payload.broadcastAddress ?? this.config.discoveryBroadcastAddress,
                password: payload.password,
                timeoutMs: payload.timeoutMs,
                preferredBindPort: payload.preferredBindPort,
            }),
        );

        await this.applyDiscoveryResults(devices);

        const mergedDevices = mergeDiscoveredDevicesIntoConfig(this.config.devices, devices);
        const response: Record<string, unknown> = {
            ok: true,
            devices,
        };

        if (devices.length === 0) {
            response.result = 'discoveryNoDevices';
        } else if (JSON.stringify(mergedDevices) !== JSON.stringify(this.config.devices ?? [])) {
            response.result = 'discoveryUpdated';
            response.saveConfig = true;
            response.native = this.buildNativeConfig(mergedDevices);
        } else {
            response.result = 'discoveryUnchanged';
        }

        this.sendMessageResponse(obj, response);
    }

    /**
     * Sends a read-only UDP request to a specific device.
     *
     * @param obj - The original ioBroker message
     */
    private async handleReadDeviceMessage(obj: ioBroker.Message): Promise<void> {
        const payload = normalizeReadDeviceMessagePayload(obj.message);

        const packet = await this.enqueueNetworkOperation(() =>
            readDevicePacket({
                host: payload.host,
                deviceId: payload.deviceId,
                password: payload.password ?? SIKU_DEFAULT_PASSWORD,
                port: payload.port,
                timeoutMs: payload.timeoutMs,
                parameters: this.normalizeReadParameters(payload.parameters),
            }),
        );

        this.sendMessageResponse(obj, { ok: true, packet: this.serializePacket(packet) });
    }

    /**
     * Executes an on-demand time check for all configured devices.
     *
     * @param obj - The original ioBroker message
     */
    private async handleSyncTimeAllMessage(obj: ioBroker.Message): Promise<void> {
        const summary = await this.runTimeChecks('manual');

        this.sendMessageResponse(obj, {
            ok: true,
            result: this.getTimeCheckResultCode(summary),
            summary,
        });
    }

    /**
     * Executes an on-demand time check for exactly one configured device.
     *
     * @param obj - The original ioBroker message
     */
    private async handleSyncTimeDeviceMessage(obj: ioBroker.Message): Promise<void> {
        const payload = normalizeSyncTimeDeviceMessagePayload(obj.message ?? {});
        const device = this.runtimeDevices.get(payload.deviceId);
        if (!device) {
            throw new Error(`Device ${payload.deviceId} is not configured in native.devices`);
        }

        const summary = await this.runTimeChecks('manual', [device]);
        this.sendMessageResponse(obj, {
            ok: true,
            result: this.getTimeCheckResultCode(summary),
            summary,
        });
    }

    /**
     * Creates the runtime registry from the adapter configuration and prepares the ioBroker object tree.
     */
    private async initializeRuntimeDevices(): Promise<void> {
        await this.extendObjectAsync('devices', {
            type: 'channel',
            common: {
                name: 'Lüftungsgeräte',
            },
            native: {},
        });

        this.runtimeDevices.clear();

        for (const [index, configuredDevice] of (this.config.devices ?? []).entries()) {
            try {
                const runtimeDevice = normalizeConfiguredDevice(configuredDevice, index);
                if (this.runtimeDevices.has(runtimeDevice.id)) {
                    this.log.warn(`Gerät ${runtimeDevice.id} ist mehrfach konfiguriert und wird nur einmal verwendet.`);
                    continue;
                }

                this.runtimeDevices.set(runtimeDevice.id, runtimeDevice);
                await this.ensureDeviceObjects(runtimeDevice);
                await this.applyConfiguredDeviceMetadata(runtimeDevice, { resetConnectionState: true });
            } catch (error) {
                this.log.warn(`Ungültige Gerätekonfiguration unter devices[${index}]: ${(error as Error).message}`);
            }
        }

        if (this.runtimeDevices.size === 0) {
            this.log.info(
                'Keine gültigen Lüfter konfiguriert. Discovery, readDevice und syncTime bleiben über sendTo nutzbar.',
            );
        }
    }

    /**
     * Subscribes to all writable adapter states once after startup.
     */
    private async subscribeWritableStates(): Promise<void> {
        for (const relativeId of [...SIKU_WRITABLE_STATE_IDS, ...SIKU_SCHEDULE_WRITABLE_STATE_IDS]) {
            await this.subscribeStatesAsync(`devices.*.${relativeId}`);
        }
    }

    /**
     * Starts the recurring polling timer for all configured devices.
     */
    private startPolling(): void {
        this.clearPollingTimer();

        if (this.runtimeDevices.size === 0) {
            return;
        }

        const intervalMs = Math.max(this.config.pollIntervalSec ?? 30, 5) * 1000;
        this.pollIntervalHandle = this.setInterval(() => {
            this.pollDevices('interval').catch((error: unknown) => {
                this.log.error(`Fehler beim Polling im Intervall: ${(error as Error).message}`);
            });
        }, intervalMs);

        this.log.debug(`Polling gestartet: alle ${intervalMs} ms`);
    }

    /**
     * Stops the recurring polling timer if it is currently active.
     */
    private clearPollingTimer(): void {
        if (this.pollIntervalHandle) {
            this.clearInterval(this.pollIntervalHandle);
            this.pollIntervalHandle = undefined;
        }
    }

    /**
     * Starts the dedicated periodic RTC check scheduler. The RTC is intentionally not part
     * of the regular polling cycle to avoid unnecessary reads of the clock parameters.
     */
    private startTimeCheckScheduler(): void {
        this.clearTimeCheckTimer();

        if (this.runtimeDevices.size === 0) {
            return;
        }

        const intervalMs = Math.max(this.config.timeCheckIntervalHours ?? 24, 1) * 60 * 60 * 1000;
        this.timeCheckIntervalHandle = this.setInterval(() => {
            this.runTimeChecks('interval').catch((error: unknown) => {
                this.log.error(`Fehler bei der Zeitprüfung im Intervall: ${(error as Error).message}`);
            });
        }, intervalMs);

        this.log.debug(`Zeitprüfung geplant: alle ${intervalMs} ms`);
    }

    /**
     * Stops the recurring time check timer if it is currently active.
     */
    private clearTimeCheckTimer(): void {
        if (this.timeCheckIntervalHandle) {
            this.clearInterval(this.timeCheckIntervalHandle);
            this.timeCheckIntervalHandle = undefined;
        }
    }

    /**
     * Polls all configured devices sequentially and updates the adapter-wide connection state.
     *
     * @param trigger - Human-readable trigger source for debug logging
     */
    private async pollDevices(trigger: SikuPollTrigger): Promise<void> {
        if (this.pollCycleRunning) {
            this.log.debug(`Polling (${trigger}) übersprungen, da bereits ein Zyklus läuft.`);
            return;
        }

        this.pollCycleRunning = true;
        let anyConnected = false;

        try {
            for (const device of this.runtimeDevices.values()) {
                anyConnected = (await this.pollSingleDevice(device, trigger)) || anyConnected;
            }

            await this.setStateChangedAsync('info.connection', anyConnected, true);
        } finally {
            this.pollCycleRunning = false;
        }
    }

    /**
     * Polls one configured device and updates its runtime states.
     *
     * @param device - Runtime device configuration
     * @param trigger - Human-readable trigger source for debug logging
     */
    private async pollSingleDevice(device: SikuRuntimeDeviceConfig, trigger: SikuPollTrigger): Promise<boolean> {
        const pollStartedAt = new Date();
        const pollStartedAtIso = pollStartedAt.toISOString();
        const pollStartedMs = Date.now();
        const prefix = device.objectId;
        const basePollParameters = Array.from(new Set([...SIKU_RUNTIME_POLL_PARAMETERS, ...SIKU_POLL_PARAMETERS])).map(
            parameter => ({ parameter }),
        );

        if (!device.enabled) {
            await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
            return false;
        }

        await this.setStateChangedAsync(`${prefix}.info.lastPoll`, pollStartedAtIso, true);

        try {
            const { basePacket, schedulePacket, scheduleReadError } = await this.enqueueDeviceOperation(
                device.id,
                async () => {
                    const basePacket = await this.enqueueNetworkOperation(() =>
                        readDevicePacket({
                            host: device.host,
                            deviceId: device.id,
                            password: device.password,
                            parameters: basePollParameters,
                        }),
                    );

                    let schedulePacket: ParsedSikuPacket | undefined;
                    let scheduleReadError: string | undefined;

                    try {
                        schedulePacket = await this.enqueueNetworkOperation(() =>
                            readDevicePacket({
                                host: device.host,
                                deviceId: device.id,
                                password: device.password,
                                parameters: buildScheduleReadRequests(),
                            }),
                        );
                    } catch (error) {
                        scheduleReadError = (error as Error).message;
                    }

                    return {
                        basePacket,
                        schedulePacket,
                        scheduleReadError,
                    };
                },
            );
            const snapshot = decodePollSnapshot(device.id, basePacket, pollStartedAt);

            await this.applyPollSnapshot(device, snapshot, pollStartedAtIso, Date.now() - pollStartedMs);
            await this.applyMappedStateUpdates(device, decodeMappedStateUpdates(basePacket));

            if (schedulePacket) {
                await this.applyMappedStateUpdates(device, decodeScheduleUpdates(schedulePacket));
            }

            await this.setStateChangedAsync(
                `${prefix}.diagnostics.lastError`,
                scheduleReadError ? `Zeitplan lesen: ${scheduleReadError}` : '',
                true,
            );

            if (scheduleReadError) {
                this.log.warn(
                    `Zeitplan-Lesen fehlgeschlagen für ${device.name} (${device.id}) via ${device.host}: ${scheduleReadError}`,
                );
            }

            this.log.debug(`Polling erfolgreich für ${device.name} (${device.id}) via ${device.host} [${trigger}]`);
            return true;
        } catch (error) {
            const message = (error as Error).message;

            await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
            await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, message, true);
            await this.setStateChangedAsync(`${prefix}.diagnostics.pollDurationMs`, Date.now() - pollStartedMs, true);

            this.log.warn(`Polling fehlgeschlagen für ${device.name} (${device.id}) via ${device.host}: ${message}`);
            return false;
        }
    }

    /**
     * Executes the dedicated RTC check for one or multiple devices and synchronizes
     * the device clock only if the absolute drift is above the configured threshold.
     *
     * @param trigger - Source of the time check
     * @param targetDevices - Optional subset of configured devices
     */
    private async runTimeChecks(
        trigger: SikuTimeCheckTrigger,
        targetDevices: SikuRuntimeDeviceConfig[] = Array.from(this.runtimeDevices.values()),
    ): Promise<TimeCheckSummary> {
        if (this.timeCheckRunning) {
            this.log.debug(`Zeitprüfung (${trigger}) übersprungen, da bereits ein Zyklus läuft.`);
            return {
                trigger,
                total: targetDevices.length,
                checked: 0,
                synced: 0,
                failed: 0,
                skipped: targetDevices.length,
                skippedBecauseBusy: true,
                devices: targetDevices.map(device => ({
                    deviceId: device.id,
                    host: device.host,
                    checked: false,
                    synced: false,
                    failed: false,
                    skipped: true,
                    driftSec: null,
                    reason: 'busy',
                    checkedAt: null,
                    syncedAt: null,
                })),
            };
        }

        this.timeCheckRunning = true;
        const results: TimeCheckDeviceResult[] = [];

        try {
            for (const device of targetDevices) {
                results.push(await this.runTimeCheckForDevice(device, trigger));
            }
        } finally {
            this.timeCheckRunning = false;
        }

        return {
            trigger,
            total: targetDevices.length,
            checked: results.filter(result => result.checked).length,
            synced: results.filter(result => result.synced).length,
            failed: results.filter(result => result.failed).length,
            skipped: results.filter(result => result.skipped).length,
            skippedBecauseBusy: false,
            devices: results,
        };
    }

    /**
     * Performs the RTC read/optional write sequence for one device.
     *
     * @param device - Runtime device configuration
     * @param trigger - Source of the time check for logging
     */
    private async runTimeCheckForDevice(
        device: SikuRuntimeDeviceConfig,
        trigger: SikuTimeCheckTrigger,
    ): Promise<TimeCheckDeviceResult> {
        const checkedAt = new Date();
        const checkedAtIso = checkedAt.toISOString();
        const prefix = device.objectId;

        await this.setStateChangedAsync(`${prefix}.diagnostics.lastTimeCheck`, checkedAtIso, true);

        if (!device.enabled) {
            return {
                deviceId: device.id,
                host: device.host,
                checked: false,
                synced: false,
                failed: false,
                skipped: true,
                driftSec: null,
                reason: 'disabled',
                checkedAt: checkedAtIso,
                syncedAt: null,
            };
        }

        try {
            const packet = await this.enqueueDeviceOperation(device.id, async () =>
                this.enqueueNetworkOperation(() =>
                    readDevicePacket({
                        host: device.host,
                        deviceId: device.id,
                        password: device.password,
                        parameters: SIKU_TIME_CHECK_PARAMETERS.map(parameter => ({ parameter })),
                    }),
                ),
            );
            const rtcSnapshot = decodeRtcSnapshot(packet);
            const referenceTime = new Date();
            const driftSec = calculateClockDriftSeconds(rtcSnapshot.deviceDate, referenceTime);

            await this.setStateChangedAsync(`${prefix}.diagnostics.clockDriftSec`, driftSec, true);
            await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, '', true);
            this.log.debug(
                `Zeitprüfung ${device.name} (${device.id}) [${trigger}]: Drift ${driftSec}s gegenüber ${referenceTime.toISOString()}`,
            );

            if (Math.abs(driftSec) <= Math.max(this.config.timeSyncThresholdSec ?? 10, 0)) {
                return {
                    deviceId: device.id,
                    host: device.host,
                    checked: true,
                    synced: false,
                    failed: false,
                    skipped: false,
                    driftSec,
                    reason: 'withinThreshold',
                    checkedAt: checkedAtIso,
                    syncedAt: null,
                };
            }

            const syncDate = new Date();
            await this.enqueueDeviceOperation(device.id, async () =>
                this.enqueueNetworkOperation(() =>
                    writeDevicePacket({
                        host: device.host,
                        deviceId: device.id,
                        password: device.password,
                        parameters: [
                            { parameter: SIKU_PARAMETER_RTC_TIME, value: encodeRtcTime(syncDate) },
                            { parameter: SIKU_PARAMETER_RTC_CALENDAR, value: encodeRtcCalendar(syncDate) },
                        ],
                    }),
                ),
            );
            const syncedAtIso = syncDate.toISOString();

            await this.setStateChangedAsync(`${prefix}.diagnostics.lastTimeSync`, syncedAtIso, true);
            this.log.info(
                `Zeit von ${device.name} (${device.id}) um ${driftSec}s korrigiert (${device.host}, ${syncedAtIso})`,
            );

            return {
                deviceId: device.id,
                host: device.host,
                checked: true,
                synced: true,
                failed: false,
                skipped: false,
                driftSec,
                reason: 'synced',
                checkedAt: checkedAtIso,
                syncedAt: syncedAtIso,
            };
        } catch (error) {
            const message = (error as Error).message;
            await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, `Zeitprüfung: ${message}`, true);
            this.log.warn(
                `Zeitprüfung fehlgeschlagen für ${device.name} (${device.id}) via ${device.host}: ${message}`,
            );

            return {
                deviceId: device.id,
                host: device.host,
                checked: false,
                synced: false,
                failed: true,
                skipped: false,
                driftSec: null,
                reason: 'error',
                checkedAt: checkedAtIso,
                syncedAt: null,
                error: message,
            };
        }
    }

    /**
     * Returns the stable result code that the JSON config button should display.
     *
     * @param summary - Summary of a manual or scheduled time check run
     */
    private getTimeCheckResultCode(summary: TimeCheckSummary): string {
        if (summary.skippedBecauseBusy) {
            return 'timeCheckBusy';
        }
        if (summary.total === 0) {
            return 'timeCheckNoDevices';
        }
        if (summary.failed > 0) {
            return 'timeCheckCompletedWithErrors';
        }
        if (summary.synced > 0) {
            return 'timeCheckSynced';
        }

        return 'timeCheckNoSyncNeeded';
    }

    /**
     * Applies the discovery results to already configured runtime devices so polling,
     * state metadata and diagnostics can immediately reflect the identified host/type.
     *
     * @param devices - Discovered devices from the latest UDP broadcast search
     */
    private async applyDiscoveryResults(devices: readonly SikuDiscoveredDevice[]): Promise<void> {
        for (const discoveredDevice of devices) {
            const runtimeDevice = this.runtimeDevices.get(discoveredDevice.deviceId);
            if (!runtimeDevice) {
                continue;
            }

            runtimeDevice.host = discoveredDevice.host;
            runtimeDevice.discoveredType = formatDiscoveredType(discoveredDevice);
            runtimeDevice.lastSeen = discoveredDevice.receivedAt;

            await this.applyConfiguredDeviceMetadata(runtimeDevice);
            if (discoveredDevice.deviceTypeCode !== null) {
                await this.setStateChangedAsync(
                    `${runtimeDevice.objectId}.info.deviceTypeCode`,
                    discoveredDevice.deviceTypeCode,
                    true,
                );
            }
            if (discoveredDevice.deviceTypeHex !== null) {
                await this.setStateChangedAsync(
                    `${runtimeDevice.objectId}.info.deviceTypeHex`,
                    discoveredDevice.deviceTypeHex,
                    true,
                );
            }
        }
    }

    /**
     * Builds the full native config object that the JSON config sendTo button can reuse.
     *
     * @param devices - Updated device list to send back to the admin UI
     */
    private buildNativeConfig(devices: ioBroker.SikuDeviceConfig[]): ioBroker.AdapterConfig {
        return {
            pollIntervalSec: this.config.pollIntervalSec,
            discoveryBroadcastAddress: this.config.discoveryBroadcastAddress,
            timeCheckIntervalHours: this.config.timeCheckIntervalHours,
            timeSyncThresholdSec: this.config.timeSyncThresholdSec,
            devices,
        };
    }

    /**
     * Writes the static metadata derived from the adapter config into the ioBroker state tree.
     *
     * @param device - Runtime device configuration
     * @param options - Optional behavior switches for initial setup
     */
    private async applyConfiguredDeviceMetadata(
        device: SikuRuntimeDeviceConfig,
        options: ApplyConfiguredMetadataOptions = {},
    ): Promise<void> {
        const prefix = device.objectId;

        await this.setStateChangedAsync(`${prefix}.info.host`, device.host, true);
        await this.setStateChangedAsync(`${prefix}.info.name`, device.name, true);
        await this.setStateChangedAsync(`${prefix}.info.deviceId`, device.id, true);
        await this.setStateChangedAsync(`${prefix}.info.enabled`, device.enabled, true);
        await this.setStateChangedAsync(`${prefix}.info.configuredType`, device.discoveredType, true);
        if (device.lastSeen) {
            await this.setStateChangedAsync(`${prefix}.info.lastSeen`, device.lastSeen, true);
            await this.setStateChangedAsync(`${prefix}.diagnostics.lastDiscovery`, device.lastSeen, true);
        }
        if (options.resetConnectionState) {
            await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
        }
    }

    /**
     * Applies a successful poll snapshot to the ioBroker states of one device.
     *
     * @param device - Runtime device configuration
     * @param snapshot - Decoded snapshot from the device response
     * @param pollStartedAtIso - Timestamp of the poll cycle start
     * @param durationMs - Measured poll duration in milliseconds
     */
    private async applyPollSnapshot(
        device: SikuRuntimeDeviceConfig,
        snapshot: SikuDevicePollSnapshot,
        pollStartedAtIso: string,
        durationMs: number,
    ): Promise<void> {
        const prefix = device.objectId;

        await this.setStateChangedAsync(`${prefix}.info.connection`, true, true);
        await this.setStateChangedAsync(`${prefix}.info.lastSeen`, snapshot.lastSeen, true);
        await this.setStateChangedAsync(`${prefix}.diagnostics.lastSuccessfulPoll`, pollStartedAtIso, true);
        await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, '', true);
        await this.setStateChangedAsync(`${prefix}.diagnostics.pollDurationMs`, durationMs, true);
        await this.setStateChangedAsync(`${prefix}.diagnostics.reportedDeviceId`, snapshot.reportedDeviceId, true);

        if (snapshot.deviceTypeCode !== null) {
            await this.setStateChangedAsync(`${prefix}.info.deviceTypeCode`, snapshot.deviceTypeCode, true);
        }
        if (snapshot.deviceTypeHex !== null) {
            await this.setStateChangedAsync(`${prefix}.info.deviceTypeHex`, snapshot.deviceTypeHex, true);
        }
        if (snapshot.ipAddress !== null) {
            await this.setStateChangedAsync(`${prefix}.info.ipAddress`, snapshot.ipAddress, true);
        }
    }

    /**
     * Applies protocol-level mapped state updates from a packet to the ioBroker object tree.
     *
     * @param device - Runtime device configuration
     * @param updates - Decoded state/value pairs from the packet
     */
    private async applyMappedStateUpdates(
        device: SikuRuntimeDeviceConfig,
        updates: Array<{ relativeId: string; value: ioBroker.StateValue }>,
    ): Promise<void> {
        for (const update of updates) {
            await this.setStateChangedAsync(`${device.objectId}.${update.relativeId}`, update.value, true);
        }
    }

    /**
     * Ensures that the base object tree for one device exists.
     *
     * @param device - Runtime device configuration
     */
    private async ensureDeviceObjects(device: SikuRuntimeDeviceConfig): Promise<void> {
        const prefix = device.objectId;

        await this.extendObjectAsync(prefix, {
            type: 'device',
            common: {
                name: device.name,
            },
            native: {
                deviceId: device.id,
            },
        });

        for (const channelDefinition of [
            { id: 'info', name: 'Information' },
            { id: 'control', name: 'Steuerung' },
            { id: 'sensors', name: 'Sensoren' },
            { id: 'timers', name: 'Timer' },
            { id: 'schedule', name: 'Zeitpläne' },
            { id: 'diagnostics', name: 'Diagnose' },
        ]) {
            await this.extendObjectAsync(`${prefix}.${channelDefinition.id}`, {
                type: 'channel',
                common: {
                    name: channelDefinition.name,
                },
                native: {},
            });
        }

        for (const dayDefinition of getScheduleDayDefinitions()) {
            await this.extendObjectAsync(`${prefix}.schedule.${dayDefinition.key}`, {
                type: 'channel',
                common: {
                    name: dayDefinition.name,
                },
                native: {},
            });

            for (const periodNumber of [1, 2, 3, 4]) {
                await this.extendObjectAsync(`${prefix}.schedule.${dayDefinition.key}.p${periodNumber}`, {
                    type: 'channel',
                    common: {
                        name: `Periode ${periodNumber}`,
                    },
                    native: {},
                });
            }
        }

        const stateDefinitions: Array<{ id: string; common: Partial<ioBroker.StateCommon> }> = [
            {
                id: `${prefix}.info.connection`,
                common: {
                    name: 'Verbunden',
                    role: 'indicator.connected',
                    type: 'boolean',
                    read: true,
                    write: false,
                    def: false,
                },
            },
            {
                id: `${prefix}.info.host`,
                common: {
                    name: 'Host',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.name`,
                common: {
                    name: 'Name',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.deviceId`,
                common: {
                    name: 'Konfigurierte Geräte-ID',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.configuredType`,
                common: {
                    name: 'Konfigurierter Typ',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.deviceTypeCode`,
                common: {
                    name: 'Gerätetyp-Code',
                    role: 'value',
                    type: 'number',
                    read: true,
                    write: false,
                },
            },
            {
                id: `${prefix}.info.deviceTypeHex`,
                common: {
                    name: 'Gerätetyp Hex',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.ipAddress`,
                common: {
                    name: 'Gemeldete IP-Adresse',
                    role: 'info.ip',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.lastSeen`,
                common: {
                    name: 'Zuletzt gesehen',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.lastPoll`,
                common: {
                    name: 'Letzter Poll-Versuch',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.info.enabled`,
                common: {
                    name: 'Aktiviert',
                    role: 'indicator',
                    type: 'boolean',
                    read: true,
                    write: false,
                    def: false,
                },
            },
            {
                id: `${prefix}.diagnostics.reportedDeviceId`,
                common: {
                    name: 'Zuletzt gemeldete Geräte-ID',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.diagnostics.lastSuccessfulPoll`,
                common: {
                    name: 'Letzter erfolgreicher Poll',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.diagnostics.lastDiscovery`,
                common: {
                    name: 'Letzte Discovery',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.diagnostics.lastTimeCheck`,
                common: {
                    name: 'Letzte Zeitprüfung',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.diagnostics.lastTimeSync`,
                common: {
                    name: 'Letzter Zeitsync',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.diagnostics.clockDriftSec`,
                common: {
                    name: 'Uhrzeitabweichung',
                    role: 'value.interval',
                    unit: 's',
                    type: 'number',
                    read: true,
                    write: false,
                    def: 0,
                },
            },
            {
                id: `${prefix}.diagnostics.lastError`,
                common: {
                    name: 'Letzter Fehler',
                    role: 'text',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
            },
            {
                id: `${prefix}.diagnostics.pollDurationMs`,
                common: {
                    name: 'Poll-Dauer',
                    role: 'value.interval',
                    unit: 'ms',
                    type: 'number',
                    read: true,
                    write: false,
                    def: 0,
                },
            },
        ];

        for (const channelId of ['info', 'control', 'sensors', 'timers', 'diagnostics']) {
            for (const definition of getStateDefinitionsByChannel(channelId)) {
                stateDefinitions.push({
                    id: `${prefix}.${definition.relativeId}`,
                    common: definition.common,
                });
            }
        }

        for (const definition of getScheduleStateDefinitions()) {
            stateDefinitions.push({
                id: `${prefix}.${definition.relativeId}`,
                common: definition.common,
            });
        }

        for (const stateDefinition of stateDefinitions) {
            await this.extendObjectAsync(stateDefinition.id, {
                type: 'state',
                common: stateDefinition.common,
                native: {},
            });
        }
    }

    /**
     * Converts messagebox read parameter definitions into the internal request format.
     *
     * @param parameters - Raw parameter definitions from the message payload
     */
    private normalizeReadParameters(parameters: unknown[]): SikuReadRequestEntry[] {
        return parameters.map((parameter, index) => {
            const location = `parameters[${index}]`;

            if (typeof parameter === 'number') {
                return { parameter: this.validateReadParameterId(parameter, location) };
            }

            if (typeof parameter !== 'object' || parameter === null) {
                throw new Error(`${location} must be a number or an object`);
            }

            const entry = parameter as Partial<SikuReadRequestEntry>;
            const normalized: SikuReadRequestEntry = {
                parameter: this.validateReadParameterId(entry.parameter, `${location}.parameter`),
            };

            if (entry.valueSize !== undefined) {
                if (!Number.isInteger(entry.valueSize) || entry.valueSize < 0 || entry.valueSize > 0xff) {
                    throw new Error(`${location}.valueSize must be an integer between 0 and 255`);
                }
                normalized.valueSize = entry.valueSize;
            }

            if (entry.requestValue !== undefined) {
                const requestValue = this.normalizeRequestValue(entry.requestValue, `${location}.requestValue`);
                const requestValueLength = requestValue.length;
                if (normalized.valueSize !== undefined && normalized.valueSize !== requestValueLength) {
                    throw new Error(
                        `${location}.valueSize (${normalized.valueSize}) must match ${location}.requestValue length (${requestValueLength})`,
                    );
                }
                normalized.requestValue = requestValue;
            }

            return normalized;
        });
    }

    /**
     * Resolves a state id to a configured runtime device plus the relative mapped state id.
     *
     * @param id - Full ioBroker state id
     */
    private resolveWritableState(
        id: string,
    ): { device: SikuRuntimeDeviceConfig; relativeId: string; fullStateId: string } | undefined {
        const relativeNamespaceId = id.slice(`${this.namespace}.`.length);
        const match = /^devices\.([A-F0-9]{16})\.(.+)$/u.exec(relativeNamespaceId);
        if (!match) {
            return undefined;
        }

        const [, deviceId, relativeId] = match;
        const device = this.runtimeDevices.get(deviceId);
        if (!device || (!SIKU_WRITABLE_STATE_IDS.includes(relativeId) && !isScheduleStateId(relativeId))) {
            return undefined;
        }

        return {
            device,
            relativeId,
            fullStateId: `${this.namespace}.${relativeNamespaceId}`,
        };
    }

    /**
     * Builds a complete schedule write request by combining the changed state with the
     * current sibling states of the same weekday/period snapshot.
     *
     * @param fullStateId - Full ioBroker id of the changed state
     * @param relativeId - Relative schedule state id
     * @param value - New user-provided value
     */
    private async buildScheduleWriteRequestForState(
        fullStateId: string,
        relativeId: string,
        value: ioBroker.StateValue,
    ): Promise<ReturnType<typeof buildScheduleWriteRequest>> {
        const values: Record<string, ioBroker.StateValue> = {};
        const namespacePrefix = `${this.namespace}.`;
        const relativeNamespaceId = fullStateId.startsWith(namespacePrefix)
            ? fullStateId.slice(namespacePrefix.length)
            : fullStateId;

        for (const snapshotRelativeId of getScheduleSnapshotStateIds(relativeId)) {
            const snapshotStateId = relativeNamespaceId.replace(relativeId, snapshotRelativeId);
            const state = await this.getStateAsync(snapshotStateId);

            if (state?.val === undefined || state.val === null) {
                throw new Error(
                    `Zeitplan-Schreibvorgang abgebrochen: Snapshot-State "${this.namespace}.${snapshotStateId}" ist nicht vorhanden oder hat keinen Wert.`,
                );
            }

            values[snapshotRelativeId] = state.val;
        }

        values[relativeId] = value;
        return buildScheduleWriteRequest(relativeId, values);
    }

    /**
     * Serializes operations per device to avoid overlapping reads and writes on the same UDP target.
     *
     * @param deviceId - Device queue key
     * @param operation - Async operation that should run exclusively for the device
     */
    private async enqueueDeviceOperation<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.deviceOperationQueues.get(deviceId) ?? Promise.resolve();
        const next = previous
            .then(
                () => undefined,
                () => undefined,
            )
            .then(() => operation());
        const tracked = next.then(
            () => undefined,
            () => undefined,
        );
        const cleanup = tracked.finally(() => {
            if (this.deviceOperationQueues.get(deviceId) === cleanup) {
                this.deviceOperationQueues.delete(deviceId);
            }
        });
        this.deviceOperationQueues.set(deviceId, cleanup);
        return next;
    }

    /**
     * Serializes UDP socket usage globally because the SIKU devices answer request traffic
     * reliably only on the shared well-known local port 4000.
     *
     * @param operation - Async network operation that should use the shared UDP slot
     */
    private async enqueueNetworkOperation<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.networkOperationQueue;
        const next = previous
            .then(
                () => undefined,
                () => undefined,
            )
            .then(() => operation());
        const tracked = next.then(
            () => undefined,
            () => undefined,
        );
        const cleanup = tracked.finally(() => {
            if (this.networkOperationQueue === cleanup) {
                this.networkOperationQueue = Promise.resolve();
            }
        });
        this.networkOperationQueue = cleanup;
        return next;
    }

    /**
     * Validates a read parameter identifier from a message payload.
     *
     * @param value - Raw parameter identifier
     * @param fieldName - Field name for error reporting
     */
    private validateReadParameterId(value: unknown, fieldName: string): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffff) {
            throw new Error(`${fieldName} must be an integer between 0 and 65535`);
        }

        return value;
    }

    /**
     * Normalizes request payload bytes and rejects invalid byte values early.
     *
     * @param requestValue - Raw request value from the message payload
     * @param fieldName - Field name for error reporting
     */
    private normalizeRequestValue(requestValue: unknown, fieldName: string): Buffer | Uint8Array | number[] {
        if (Buffer.isBuffer(requestValue)) {
            return Buffer.from(requestValue);
        }

        if (requestValue instanceof Uint8Array) {
            return new Uint8Array(requestValue);
        }

        if (Array.isArray(requestValue)) {
            requestValue.forEach((value, index) => {
                if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xff) {
                    throw new Error(`${fieldName}[${index}] must be an integer between 0 and 255`);
                }
            });
            return requestValue.map(value => value as number);
        }

        throw new Error(`${fieldName} must be a Buffer, Uint8Array or array of byte values`);
    }

    /**
     * Converts a parsed packet into a JSON-serializable payload for sendTo callbacks.
     *
     * @param packet - Parsed SIKU packet
     */
    private serializePacket(packet: ParsedSikuPacket): Record<string, unknown> {
        return {
            protocolType: packet.protocolType,
            checksum: packet.checksum,
            checksumValid: packet.checksumValid,
            deviceId: packet.deviceIdText,
            passwordLength: packet.passwordBytes.length,
            functionCode: packet.functionCode,
            entries: packet.entries.map(entry => ({
                parameter: entry.parameter,
                parameterHex: `0x${entry.parameter.toString(16).padStart(4, '0')}`,
                size: entry.size,
                unsupported: entry.unsupported,
                functionCode: entry.functionCode,
                valueHex: toHex(entry.value),
            })),
        };
    }

    /**
     * Sends a messagebox response if the caller provided a callback.
     *
     * @param obj - The original ioBroker message
     * @param response - JSON-serializable response payload
     */
    private sendMessageResponse(obj: ioBroker.Message, response: Record<string, unknown>): void {
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, response, obj.callback);
        }
    }

    /**
     * Logs a sanitized configuration snapshot without leaking device passwords into debug logs.
     */
    private logSafeConfig(): void {
        const devices = this.config.devices ?? [];
        const enabledDevices = devices.filter(device => device.enabled).length;

        this.log.debug(
            `Konfiguration: ${JSON.stringify({
                pollIntervalSec: this.config.pollIntervalSec,
                discoveryBroadcastAddress: this.config.discoveryBroadcastAddress,
                timeCheckIntervalHours: this.config.timeCheckIntervalHours,
                timeSyncThresholdSec: this.config.timeSyncThresholdSec,
                configuredDevices: devices.length,
                enabledDevices,
            })}`,
        );
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Siku(options);
} else {
    // otherwise start the instance directly
    (() => new Siku())();
}
