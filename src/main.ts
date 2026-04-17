/*
 * Created with @iobroker/create-adapter v3.1.2
 */

import * as utils from '@iobroker/adapter-core';
import { discoverDevices, readDevicePacket } from './lib/siku-network';
import { toHex } from './lib/siku-protocol';
import type { ParsedSikuPacket, SikuReadRequestEntry } from './lib/siku-protocol';

interface DiscoverMessagePayload {
    broadcastAddress?: string;
    password?: string;
    timeoutMs?: number;
    preferredBindPort?: number;
}

interface ReadDeviceMessagePayload {
    host: string;
    deviceId: string;
    password?: string;
    port?: number;
    timeoutMs?: number;
    parameters: Array<number | SikuReadRequestEntry>;
}

class Siku extends utils.Adapter {
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

        this.log.info('Starte SIKU-Adapter im Bootstrap-Modus');
        this.logSafeConfig();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
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
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (typeof obj !== 'object' || !obj.command) {
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
        const payload = (typeof obj.message === 'object' ? obj.message : {}) as DiscoverMessagePayload;
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
        if (typeof obj.message !== 'object' || obj.message === null) {
            throw new Error('readDevice requires an object payload');
        }

        const payload = obj.message as ReadDeviceMessagePayload;
        if (!payload.host || !payload.deviceId || !Array.isArray(payload.parameters)) {
            throw new Error('readDevice requires host, deviceId and parameters');
        }

        const packet = await readDevicePacket({
            host: payload.host,
            deviceId: payload.deviceId,
            password: payload.password ?? '1111',
            port: payload.port,
            timeoutMs: payload.timeoutMs,
            parameters: this.normalizeReadParameters(payload.parameters),
        });

        this.sendMessageResponse(obj, { ok: true, packet: this.serializePacket(packet) });
    }

    /**
     * Converts messagebox read parameter definitions into the internal request format.
     *
     * @param parameters - Raw parameter definitions from the message payload
     */
    private normalizeReadParameters(parameters: Array<number | SikuReadRequestEntry>): SikuReadRequestEntry[] {
        return parameters.map(parameter =>
            typeof parameter === 'number'
                ? { parameter }
                : {
                      parameter: parameter.parameter,
                      valueSize: parameter.valueSize,
                      requestValue: parameter.requestValue,
                  },
        );
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
