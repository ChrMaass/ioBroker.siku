/*
 * Created with @iobroker/create-adapter v3.1.2
 */

import * as utils from '@iobroker/adapter-core';
import { SIKU_DEFAULT_PASSWORD, SIKU_RUNTIME_POLL_PARAMETERS } from './lib/siku-constants';
import { normalizeDiscoverMessagePayload, normalizeReadDeviceMessagePayload } from './lib/siku-message-validation';
import { discoverDevices, readDevicePacket } from './lib/siku-network';
import { toHex } from './lib/siku-protocol';
import { decodePollSnapshot, normalizeConfiguredDevice } from './lib/siku-runtime';
import type { ParsedSikuPacket, SikuReadRequestEntry } from './lib/siku-protocol';
import type { SikuDevicePollSnapshot, SikuRuntimeDeviceConfig } from './lib/siku-runtime';

class Siku extends utils.Adapter {
    private readonly runtimeDevices = new Map<string, SikuRuntimeDeviceConfig>();
    private pollCycleRunning = false;
    private pollIntervalHandle: NodeJS.Timeout | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'siku',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', obj => {
            void this.onMessage(obj);
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
        await this.pollDevices('startup');
        this.startPolling();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            this.clearPollingTimer();
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
     * Performs a network discovery using UDP broadcast and returns JSON-serializable results.
     *
     * @param obj - The original ioBroker message
     */
    private async handleDiscoverMessage(obj: ioBroker.Message): Promise<void> {
        const payload = normalizeDiscoverMessagePayload(obj.message ?? {});
        const devices = await discoverDevices({
            broadcastAddress: payload.broadcastAddress ?? this.config.discoveryBroadcastAddress,
            password: payload.password,
            timeoutMs: payload.timeoutMs,
            preferredBindPort: payload.preferredBindPort,
        });

        this.sendMessageResponse(obj, { ok: true, devices });
    }

    /**
     * Sends a read-only UDP request to a specific device.
     *
     * @param obj - The original ioBroker message
     */
    private async handleReadDeviceMessage(obj: ioBroker.Message): Promise<void> {
        const payload = normalizeReadDeviceMessagePayload(obj.message);

        const packet = await readDevicePacket({
            host: payload.host,
            deviceId: payload.deviceId,
            password: payload.password ?? SIKU_DEFAULT_PASSWORD,
            port: payload.port,
            timeoutMs: payload.timeoutMs,
            parameters: this.normalizeReadParameters(payload.parameters),
        });

        this.sendMessageResponse(obj, { ok: true, packet: this.serializePacket(packet) });
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
                await this.applyConfiguredDeviceMetadata(runtimeDevice);
            } catch (error) {
                this.log.warn(`Ungültige Gerätekonfiguration unter devices[${index}]: ${(error as Error).message}`);
            }
        }

        if (this.runtimeDevices.size === 0) {
            this.log.info(
                'Keine gültigen Lüfter konfiguriert. Discovery und readDevice sind weiterhin über sendTo nutzbar.',
            );
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
        this.pollIntervalHandle = setInterval(() => {
            void this.pollDevices('interval');
        }, intervalMs);

        this.log.debug(`Polling gestartet: alle ${intervalMs} ms`);
    }

    /**
     * Stops the recurring polling timer if it is currently active.
     */
    private clearPollingTimer(): void {
        if (this.pollIntervalHandle) {
            clearInterval(this.pollIntervalHandle);
            this.pollIntervalHandle = undefined;
        }
    }

    /**
     * Polls all configured devices sequentially and updates the adapter-wide connection state.
     *
     * @param trigger - Human-readable trigger source for debug logging
     */
    private async pollDevices(trigger: 'startup' | 'interval'): Promise<void> {
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
    private async pollSingleDevice(device: SikuRuntimeDeviceConfig, trigger: 'startup' | 'interval'): Promise<boolean> {
        const pollStartedAt = new Date();
        const pollStartedAtIso = pollStartedAt.toISOString();
        const pollStartedMs = Date.now();
        const prefix = device.objectId;

        if (!device.enabled) {
            await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
            return false;
        }

        await this.setStateChangedAsync(`${prefix}.info.lastPoll`, pollStartedAtIso, true);

        try {
            const packet = await readDevicePacket({
                host: device.host,
                deviceId: device.id,
                password: device.password,
                parameters: SIKU_RUNTIME_POLL_PARAMETERS.map(parameter => ({ parameter })),
            });
            const snapshot = decodePollSnapshot(device.id, packet, pollStartedAt);

            await this.applyPollSnapshot(device, snapshot, pollStartedAtIso, Date.now() - pollStartedMs);
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
     * Writes the static metadata derived from the adapter config into the ioBroker state tree.
     *
     * @param device - Runtime device configuration
     */
    private async applyConfiguredDeviceMetadata(device: SikuRuntimeDeviceConfig): Promise<void> {
        const prefix = device.objectId;

        await this.setStateChangedAsync(`${prefix}.info.host`, device.host, true);
        await this.setStateChangedAsync(`${prefix}.info.name`, device.name, true);
        await this.setStateChangedAsync(`${prefix}.info.deviceId`, device.id, true);
        await this.setStateChangedAsync(`${prefix}.info.enabled`, device.enabled, true);
        await this.setStateChangedAsync(`${prefix}.info.configuredType`, device.discoveredType, true);
        if (device.lastSeen) {
            await this.setStateChangedAsync(`${prefix}.info.lastSeen`, device.lastSeen, true);
        }
        await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
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

        if (snapshot.power !== null) {
            await this.setStateChangedAsync(`${prefix}.control.power`, snapshot.power, true);
        }
        if (snapshot.fanSpeed !== null) {
            await this.setStateChangedAsync(`${prefix}.control.fanSpeed`, snapshot.fanSpeed, true);
        }
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
                id: `${prefix}.control.power`,
                common: {
                    name: 'Eingeschaltet',
                    role: 'switch',
                    type: 'boolean',
                    read: true,
                    write: false,
                    def: false,
                },
            },
            {
                id: `${prefix}.control.fanSpeed`,
                common: {
                    name: 'Lüfterstufe',
                    role: 'level.speed',
                    type: 'number',
                    read: true,
                    write: false,
                    def: 0,
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
