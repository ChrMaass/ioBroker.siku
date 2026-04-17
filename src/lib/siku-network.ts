import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import {
    SIKU_DEFAULT_PASSWORD,
    SIKU_DEFAULT_PORT,
    SIKU_DISCOVERY_TIMEOUT_MS,
    SIKU_PARAMETER_DEVICE_ID,
    SIKU_PARAMETER_DEVICE_TYPE,
    SIKU_REQUEST_RETRY_DELAYS_MS,
    SIKU_REQUEST_TIMEOUT_MS,
    SikuFunction,
} from './siku-constants';
import {
    buildDiscoveryPacket,
    buildReadPacket,
    decodeAscii,
    decodeUnsignedLE,
    parsePacket,
    toHex,
} from './siku-protocol';
import type { ParsedSikuPacket, SikuReadRequestEntry } from './siku-protocol';

export interface SikuDiscoveredDevice {
    host: string;
    port: number;
    deviceId: string;
    deviceTypeCode: number | null;
    deviceTypeHex: string | null;
    receivedAt: string;
}

export interface SikuDiscoveryOptions {
    broadcastAddress: string;
    password?: string;
    port?: number;
    timeoutMs?: number;
    preferredBindPort?: number;
}

export interface SikuReadDeviceOptions {
    host: string;
    deviceId: string;
    password: string;
    parameters: SikuReadRequestEntry[];
    port?: number;
    timeoutMs?: number;
    retryDelaysMs?: readonly number[];
}

interface SikuDiscoverySocket {
    on(event: 'message', listener: (message: Buffer, remoteInfo: dgram.RemoteInfo) => void): this;
    send(buffer: Buffer, port: number, address: string, callback: (error: Error | null) => void): void;
    setBroadcast(flag: boolean): void;
    close(): void;
    address(): AddressInfo;
}

export interface SikuNetworkDependencies {
    bindSocketWithFallback?: (preferredPort: number) => Promise<SikuDiscoverySocket>;
    requestOnce?: (host: string, port: number, payload: Buffer, timeoutMs: number) => Promise<Buffer>;
    delay?: (timeoutMs: number) => Promise<unknown>;
    getLocalIPv4Addresses?: () => Set<string>;
    now?: () => Date;
}

function getLocalIPv4Addresses(): Set<string> {
    const interfaces = networkInterfaces();
    const localAddresses = new Set<string>();

    for (const interfaceEntries of Object.values(interfaces)) {
        for (const entry of interfaceEntries ?? []) {
            if (entry.family === 'IPv4') {
                localAddresses.add(entry.address);
            }
        }
    }

    return localAddresses;
}

async function bindSocketWithFallback(preferredPort: number): Promise<dgram.Socket> {
    const portsToTry = preferredPort === 0 ? [0] : [preferredPort, 0];

    for (const port of portsToTry) {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        try {
            await new Promise<void>((resolve, reject) => {
                function onListening(): void {
                    socket.off('error', onError);
                    resolve();
                }
                function onError(error: Error): void {
                    socket.off('listening', onListening);
                    reject(error);
                }

                socket.once('error', onError);
                socket.once('listening', onListening);
                socket.bind(port);
            });
            return socket;
        } catch {
            socket.close();
            if (port === 0) {
                throw new Error('Unable to bind UDP socket for discovery');
            }
        }
    }

    throw new Error('Unable to bind UDP socket for discovery');
}

async function requestOnce(host: string, port: number, payload: Buffer, timeoutMs: number): Promise<Buffer> {
    const socket = dgram.createSocket('udp4');

    return new Promise<Buffer>((resolve, reject) => {
        let finished = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        const cleanup = (): void => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            socket.removeAllListeners();
            socket.close();
        };

        const finish = (error?: Error, response?: Buffer): void => {
            if (finished) {
                return;
            }
            finished = true;
            cleanup();
            if (error) {
                reject(error);
            } else if (response) {
                resolve(response);
            } else {
                reject(new Error('No response received'));
            }
        };

        socket.on('error', finish);
        socket.on('message', (message, remoteInfo) => {
            if (remoteInfo.address === host && remoteInfo.port === port) {
                finish(undefined, message);
            }
        });
        socket.bind(0, () => {
            socket.send(payload, port, host, error => {
                if (error) {
                    finish(error);
                    return;
                }
                timeoutHandle = setTimeout(() => {
                    finish(new Error(`UDP request to ${host}:${port} timed out after ${timeoutMs} ms`));
                }, timeoutMs);
            });
        });
    });
}

/**
 * Returns whether a discovery message is only the local broadcast echo and should be ignored.
 *
 * @param message - Raw UDP payload
 * @param remoteInfo - Sender information for the datagram
 * @param localAddresses - Known local IPv4 addresses of the current host
 * @param boundPort - Local UDP port that the discovery socket is bound to
 * @param discoveryPacket - Original discovery request packet
 */
export function isDiscoverySelfEcho(
    message: Buffer,
    remoteInfo: Pick<dgram.RemoteInfo, 'address' | 'port'>,
    localAddresses: ReadonlySet<string>,
    boundPort: number,
    discoveryPacket: Buffer,
): boolean {
    if (message.equals(discoveryPacket)) {
        return true;
    }

    return localAddresses.has(remoteInfo.address) && remoteInfo.port === boundPort;
}

/**
 * Parses a discovery response into a normalized device descriptor.
 *
 * @param message - Raw UDP discovery response
 * @param remoteInfo - Sender information for the datagram
 * @param receivedAt - Timestamp used for deterministic tests and logging
 */
export function parseDiscoveryResponse(
    message: Buffer,
    remoteInfo: Pick<dgram.RemoteInfo, 'address' | 'port'>,
    receivedAt: Date = new Date(),
): SikuDiscoveredDevice | null {
    let parsed: ParsedSikuPacket;
    try {
        parsed = parsePacket(message);
    } catch {
        return null;
    }

    if (!parsed.checksumValid || parsed.functionCode !== SikuFunction.Response) {
        return null;
    }

    const idEntry = parsed.entries.find(entry => entry.parameter === SIKU_PARAMETER_DEVICE_ID && !entry.unsupported);
    const deviceTypeEntry = parsed.entries.find(
        entry => entry.parameter === SIKU_PARAMETER_DEVICE_TYPE && !entry.unsupported,
    );
    const deviceId = decodeAscii(idEntry?.value ?? parsed.deviceIdBytes);
    if (!deviceId) {
        return null;
    }

    return {
        host: remoteInfo.address,
        port: remoteInfo.port,
        deviceId,
        deviceTypeCode: deviceTypeEntry ? decodeUnsignedLE(deviceTypeEntry.value) : null,
        deviceTypeHex: deviceTypeEntry ? toHex(deviceTypeEntry.value) : null,
        receivedAt: receivedAt.toISOString(),
    };
}

export async function readDevicePacket(
    options: SikuReadDeviceOptions,
    dependencies: SikuNetworkDependencies = {},
): Promise<ParsedSikuPacket> {
    const payload = buildReadPacket(options.deviceId, options.password, options.parameters);
    const retryDelays = options.retryDelaysMs ?? SIKU_REQUEST_RETRY_DELAYS_MS;
    const request = dependencies.requestOnce ?? requestOnce;
    const wait = dependencies.delay ?? delay;
    let lastError: Error | undefined;

    for (const retryDelay of retryDelays) {
        try {
            if (retryDelay > 0) {
                await wait(retryDelay);
            }
            const response = await request(
                options.host,
                options.port ?? SIKU_DEFAULT_PORT,
                payload,
                options.timeoutMs ?? SIKU_REQUEST_TIMEOUT_MS,
            );
            const parsed = parsePacket(response);
            if (!parsed.checksumValid) {
                throw new Error(`Invalid checksum in response from ${options.host}`);
            }
            if (parsed.functionCode !== SikuFunction.Response) {
                throw new Error(
                    `Unexpected function code 0x${parsed.functionCode.toString(16).padStart(2, '0')} in response from ${options.host}`,
                );
            }
            return parsed;
        } catch (error) {
            lastError = error as Error;
        }
    }

    throw lastError ?? new Error(`Unable to read from ${options.host}`);
}

export async function discoverDevices(
    options: SikuDiscoveryOptions,
    dependencies: SikuNetworkDependencies = {},
): Promise<SikuDiscoveredDevice[]> {
    const bind = dependencies.bindSocketWithFallback ?? bindSocketWithFallback;
    const wait = dependencies.delay ?? delay;
    const now = dependencies.now ?? (() => new Date());
    const localAddresses = (dependencies.getLocalIPv4Addresses ?? getLocalIPv4Addresses)();
    const socket = await bind(options.preferredBindPort ?? SIKU_DEFAULT_PORT);
    const discoveryPacket = buildDiscoveryPacket(options.password ?? SIKU_DEFAULT_PASSWORD);

    try {
        socket.setBroadcast(true);
        const devices = new Map<string, SikuDiscoveredDevice>();

        socket.on('message', (message, remoteInfo) => {
            if (isDiscoverySelfEcho(message, remoteInfo, localAddresses, socket.address().port, discoveryPacket)) {
                return;
            }

            try {
                const device = parseDiscoveryResponse(message, remoteInfo, now());
                if (!device) {
                    return;
                }

                devices.set(device.deviceId, device);
            } catch {
                // Ignore unrelated or malformed UDP packets during discovery.
            }
        });

        await new Promise<void>((resolve, reject) => {
            socket.send(discoveryPacket, options.port ?? SIKU_DEFAULT_PORT, options.broadcastAddress, error =>
                error ? reject(error) : resolve(),
            );
        });

        await wait(options.timeoutMs ?? SIKU_DISCOVERY_TIMEOUT_MS);
        return Array.from(devices.values()).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
    } finally {
        socket.close();
    }
}
