import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { setTimeout as nodeTimer } from 'node:timers/promises';
import {
    SIKU_DEFAULT_PASSWORD,
    SIKU_DEFAULT_PORT,
    SIKU_DISCOVERY_MAX_PASSWORDS,
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
    buildWritePacket,
    decodeAscii,
    decodeUnsignedLE,
    parsePacket,
    toHex,
} from './siku-protocol';
import type { ParsedSikuPacket, SikuReadRequestEntry, SikuWriteRequestEntry } from './siku-protocol';

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
    /** Optional credential candidates sent within the same bounded discovery window. */
    passwords?: readonly string[];
    port?: number;
    timeoutMs?: number;
    preferredBindPort?: number;
    signal?: AbortSignal;
}

export interface SikuReadDeviceOptions {
    host: string;
    deviceId: string;
    password: string;
    parameters: SikuReadRequestEntry[];
    port?: number;
    localPort?: number;
    timeoutMs?: number;
    retryDelaysMs?: readonly number[];
    signal?: AbortSignal;
}

export interface SikuWriteDeviceOptions {
    host: string;
    deviceId: string;
    password: string;
    parameters: SikuWriteRequestEntry[];
    port?: number;
    localPort?: number;
    timeoutMs?: number;
    retryDelaysMs?: readonly number[];
    signal?: AbortSignal;
}

interface SikuDiscoverySocket {
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'message', listener: (message: Buffer, remoteInfo: dgram.RemoteInfo) => void): this;
    send(buffer: Buffer, port: number, address: string, callback: (error: Error | null) => void): void;
    setBroadcast(flag: boolean): void;
    removeAllListeners(): this;
    close(): void;
    address(): AddressInfo;
}

interface SikuRequestSocket {
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'message', listener: (message: Buffer, remoteInfo: dgram.RemoteInfo) => void): this;
    send(buffer: Buffer, port: number, address: string, callback: (error: Error | null) => void): void;
    removeAllListeners(): this;
    close(): void;
}

function closeSocketSafely(socket: SikuDiscoverySocket | SikuRequestSocket): void {
    socket.removeAllListeners();
    // A datagram send can report a late error while close is already in progress.
    // Keep a final guard so a handled timeout or abort cannot crash the process.
    socket.on('error', () => undefined);
    socket.close();
}

export interface SikuNetworkDependencies {
    bindSocketWithFallback?: (preferredPort: number) => Promise<SikuDiscoverySocket>;
    bindRequestSocket?: (localPort: number) => Promise<SikuRequestSocket>;
    requestOnce?: (
        host: string,
        port: number,
        payload: Buffer,
        timeoutMs: number,
        localPort: number,
        signal?: AbortSignal,
    ) => Promise<Buffer>;
    sendOnce?: (host: string, port: number, payload: Buffer, localPort: number, signal?: AbortSignal) => Promise<void>;
    timer?: (timeoutMs: number) => Promise<unknown>;
    getLocalIPv4Addresses?: () => Set<string>;
    now?: () => Date;
}

function createAbortError(): Error {
    const error = new Error('SIKU network operation aborted');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw createAbortError();
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
        return promise;
    }
    const abortSignal = signal;
    throwIfAborted(abortSignal);

    return new Promise<T>((resolve, reject) => {
        function cleanup(): void {
            abortSignal.removeEventListener('abort', onAbort);
        }
        function onAbort(): void {
            cleanup();
            reject(createAbortError());
        }

        abortSignal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                cleanup();
                resolve(value);
            },
            error => {
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}

async function waitForDelay(
    timeoutMs: number,
    injectedTimer: SikuNetworkDependencies['timer'],
    signal?: AbortSignal,
): Promise<void> {
    if (injectedTimer) {
        await waitWithSignal(Promise.resolve(injectedTimer(timeoutMs)), signal);
        return;
    }

    try {
        await nodeTimer(timeoutMs, undefined, signal ? { signal } : undefined);
    } catch (error) {
        if (isAbortError(error)) {
            throw createAbortError();
        }
        throw error;
    }
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

async function bindRequestSocket(localPort: number): Promise<dgram.Socket> {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

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
        socket.bind(localPort);
    }).catch(error => {
        socket.close();
        throw new Error(`Unable to bind UDP request socket to local port ${localPort}: ${(error as Error).message}`);
    });

    return socket;
}

async function requestOnce(
    host: string,
    port: number,
    payload: Buffer,
    timeoutMs: number,
    localPort: number = port,
    bindRequest: (localPort: number) => Promise<SikuRequestSocket> = bindRequestSocket,
    signal?: AbortSignal,
): Promise<Buffer> {
    throwIfAborted(signal);
    const socket = await bindRequest(localPort);

    return new Promise<Buffer>((resolve, reject) => {
        let finished = false;
        const timeoutHandle = setTimeout(onTimeout, timeoutMs);
        timeoutHandle.unref?.();

        const cleanup = (): void => {
            clearTimeout(timeoutHandle);
            signal?.removeEventListener('abort', onAbort);
            closeSocketSafely(socket);
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

        function onTimeout(): void {
            finish(new Error(`UDP request to ${host}:${port} timed out after ${timeoutMs} ms`));
        }

        function onAbort(): void {
            finish(createAbortError());
        }

        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        socket.on('error', finish);
        socket.on('message', (message, remoteInfo) => {
            if (remoteInfo.address === host && remoteInfo.port === port) {
                finish(undefined, message);
            }
        });
        socket.send(payload, port, host, error => {
            if (error) {
                finish(error);
            }
        });
    });
}

async function sendOnce(
    host: string,
    port: number,
    payload: Buffer,
    localPort: number = port,
    bindRequest: (localPort: number) => Promise<SikuRequestSocket> = bindRequestSocket,
    signal?: AbortSignal,
): Promise<void> {
    throwIfAborted(signal);
    const socket = await bindRequest(localPort);

    return new Promise<void>((resolve, reject) => {
        let finished = false;
        const finish = (error?: Error): void => {
            if (finished) {
                return;
            }
            finished = true;
            signal?.removeEventListener('abort', onAbort);
            closeSocketSafely(socket);
            error ? reject(error) : resolve();
        };

        function onAbort(): void {
            finish(createAbortError());
        }

        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        socket.on('error', finish);
        socket.send(payload, port, host, error => finish(error ?? undefined));
    });
}

function getParameterCounts(parameters: readonly number[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const parameter of parameters) {
        counts.set(parameter, (counts.get(parameter) ?? 0) + 1);
    }
    return counts;
}

function validateResponseCorrelation(
    packet: ParsedSikuPacket,
    host: string,
    expectedDeviceId: string,
    expectedParameters: readonly number[],
): void {
    if (packet.deviceIdText.toUpperCase() !== expectedDeviceId.toUpperCase()) {
        throw new Error(`Response from ${host} belongs to device ${packet.deviceIdText}, expected ${expectedDeviceId}`);
    }

    const expectedCounts = getParameterCounts(expectedParameters);
    const actualCounts = getParameterCounts(packet.entries.map(entry => entry.parameter));
    for (const [parameter, expectedCount] of expectedCounts) {
        if ((actualCounts.get(parameter) ?? 0) < expectedCount) {
            throw new Error(`Response from ${host} is missing parameter 0x${parameter.toString(16).padStart(4, '0')}`);
        }
    }
}

async function executeRequestWithRetries(
    host: string,
    port: number,
    payload: Buffer,
    timeoutMs: number,
    localPort: number,
    retryDelaysMs: readonly number[],
    expectedDeviceId: string,
    expectedParameters: readonly number[],
    signal: AbortSignal | undefined,
    dependencies: SikuNetworkDependencies,
): Promise<ParsedSikuPacket> {
    const request =
        dependencies.requestOnce ??
        ((targetHost, targetPort, requestPayload, requestTimeoutMs, requestLocalPort, requestSignal) =>
            requestOnce(
                targetHost,
                targetPort,
                requestPayload,
                requestTimeoutMs,
                requestLocalPort,
                dependencies.bindRequestSocket,
                requestSignal,
            ));
    let lastError: Error | undefined;

    for (const retryDelay of retryDelaysMs) {
        try {
            throwIfAborted(signal);
            if (retryDelay > 0) {
                await waitForDelay(retryDelay, dependencies.timer, signal);
            }

            const response = await request(host, port, payload, timeoutMs, localPort, signal);
            const parsed = parsePacket(response);
            if (!parsed.checksumValid) {
                throw new Error(`Invalid checksum in response from ${host}`);
            }
            if (parsed.functionCode !== SikuFunction.Response) {
                throw new Error(
                    `Unexpected function code 0x${parsed.functionCode.toString(16).padStart(2, '0')} in response from ${host}`,
                );
            }
            validateResponseCorrelation(parsed, host, expectedDeviceId, expectedParameters);

            return parsed;
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            lastError = error as Error;
        }
    }

    throw lastError ?? new Error(`Unable to communicate with ${host}`);
}

function normalizeWriteValue(value: SikuWriteRequestEntry['value']): Buffer {
    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }

    return Buffer.from(value);
}

function validateWriteEcho(packet: ParsedSikuPacket, parameters: readonly SikuWriteRequestEntry[], host: string): void {
    for (const parameter of parameters) {
        const entry = packet.entries.find(responseEntry => responseEntry.parameter === parameter.parameter);
        if (!entry) {
            throw new Error(
                `Write response from ${host} does not contain parameter 0x${parameter.parameter.toString(16).padStart(4, '0')}`,
            );
        }
        if (entry.unsupported) {
            throw new Error(
                `Write response from ${host} marked parameter 0x${parameter.parameter.toString(16).padStart(4, '0')} as unsupported`,
            );
        }

        const expectedValue = normalizeWriteValue(parameter.value);
        if (!entry.value.equals(expectedValue)) {
            throw new Error(
                `Write response mismatch for parameter 0x${parameter.parameter.toString(16).padStart(4, '0')} from ${host}`,
            );
        }
    }
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
    const deviceId = decodeAscii(idEntry?.value ?? parsed.deviceIdBytes).toUpperCase();
    if (!/^[0-9A-F]{16}$/u.test(deviceId)) {
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

/**
 * Reads one or more parameters from a specific device.
 *
 * @param options - Request target and parameter definition
 * @param dependencies - Optional injected network dependencies for tests
 */
export async function readDevicePacket(
    options: SikuReadDeviceOptions,
    dependencies: SikuNetworkDependencies = {},
): Promise<ParsedSikuPacket> {
    const payload = buildReadPacket(options.deviceId, options.password, options.parameters);

    return executeRequestWithRetries(
        options.host,
        options.port ?? SIKU_DEFAULT_PORT,
        payload,
        options.timeoutMs ?? SIKU_REQUEST_TIMEOUT_MS,
        options.localPort ?? options.port ?? SIKU_DEFAULT_PORT,
        options.retryDelaysMs ?? SIKU_REQUEST_RETRY_DELAYS_MS,
        options.deviceId,
        options.parameters.map(parameter => parameter.parameter),
        options.signal,
        dependencies,
    );
}

/**
 * Writes one or more parameters using function 0x03 and validates the echoed response.
 *
 * @param options - Request target and parameter/value definition
 * @param dependencies - Optional injected network dependencies for tests
 */
export async function writeDevicePacket(
    options: SikuWriteDeviceOptions,
    dependencies: SikuNetworkDependencies = {},
): Promise<ParsedSikuPacket> {
    const payload = buildWritePacket(options.deviceId, options.password, SikuFunction.ReadWrite, options.parameters);

    const packet = await executeRequestWithRetries(
        options.host,
        options.port ?? SIKU_DEFAULT_PORT,
        payload,
        options.timeoutMs ?? SIKU_REQUEST_TIMEOUT_MS,
        options.localPort ?? options.port ?? SIKU_DEFAULT_PORT,
        options.retryDelaysMs ?? SIKU_REQUEST_RETRY_DELAYS_MS,
        options.deviceId,
        options.parameters.map(parameter => parameter.parameter),
        options.signal,
        dependencies,
    );

    validateWriteEcho(packet, options.parameters, options.host);
    return packet;
}

/**
 * Sends a protocol function 0x02 command exactly once.
 *
 * W-only parameters intentionally do not return an acknowledgement. Retrying them after a timeout
 * could repeat a destructive action, so success here only confirms that the UDP datagram was sent.
 * Callers should verify the resulting readable status separately where possible.
 *
 * @param options - Target, credentials and the single write-only parameter
 * @param dependencies - Optional test/runtime dependency overrides
 */
export async function sendWriteOnlyDevicePacket(
    options: SikuWriteDeviceOptions,
    dependencies: SikuNetworkDependencies = {},
): Promise<void> {
    const port = options.port ?? SIKU_DEFAULT_PORT;
    const localPort = options.localPort ?? port;
    const payload = buildWritePacket(options.deviceId, options.password, SikuFunction.Write, options.parameters);
    const send =
        dependencies.sendOnce ??
        ((targetHost, targetPort, requestPayload, requestLocalPort, requestSignal) =>
            sendOnce(
                targetHost,
                targetPort,
                requestPayload,
                requestLocalPort,
                dependencies.bindRequestSocket,
                requestSignal,
            ));

    await send(options.host, port, payload, localPort, options.signal);
}

export async function discoverDevices(
    options: SikuDiscoveryOptions,
    dependencies: SikuNetworkDependencies = {},
): Promise<SikuDiscoveredDevice[]> {
    const bind = dependencies.bindSocketWithFallback ?? bindSocketWithFallback;
    const now = dependencies.now ?? (() => new Date());
    const localAddresses = (dependencies.getLocalIPv4Addresses ?? getLocalIPv4Addresses)();
    throwIfAborted(options.signal);
    const socket = await bind(options.preferredBindPort ?? SIKU_DEFAULT_PORT);
    const discoveryPasswords = Array.from(
        new Set(options.passwords?.length ? options.passwords : [options.password ?? SIKU_DEFAULT_PASSWORD]),
    ).slice(0, SIKU_DISCOVERY_MAX_PASSWORDS);
    const discoveryPackets = discoveryPasswords.map(password => buildDiscoveryPacket(password));

    try {
        throwIfAborted(options.signal);
        socket.setBroadcast(true);
        const devices = new Map<string, SikuDiscoveredDevice>();

        socket.on('message', (message, remoteInfo) => {
            if (
                discoveryPackets.some(discoveryPacket =>
                    isDiscoverySelfEcho(message, remoteInfo, localAddresses, socket.address().port, discoveryPacket),
                )
            ) {
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

        const socketError = new Promise<never>((_resolve, reject) => {
            socket.on('error', reject);
        });
        const discoveryWindow = (async (): Promise<void> => {
            await Promise.all(
                discoveryPackets.map(
                    discoveryPacket =>
                        new Promise<void>((resolve, reject) => {
                            socket.send(
                                discoveryPacket,
                                options.port ?? SIKU_DEFAULT_PORT,
                                options.broadcastAddress,
                                error => (error ? reject(error) : resolve()),
                            );
                        }),
                ),
            );
            await waitForDelay(options.timeoutMs ?? SIKU_DISCOVERY_TIMEOUT_MS, dependencies.timer, options.signal);
        })();

        await waitWithSignal(Promise.race([discoveryWindow, socketError]), options.signal);
        return Array.from(devices.values()).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
    } finally {
        closeSocketSafely(socket);
    }
}
