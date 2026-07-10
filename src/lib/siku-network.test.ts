import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect } from 'chai';
import { buildDiscoveryPacket, buildPacket, decodeUnsignedLE, parsePacket } from './siku-protocol';
import { SikuFunction } from './siku-constants';
import {
    discoverDevices,
    isDiscoverySelfEcho,
    parseDiscoveryResponse,
    readDevicePacket,
    sendWriteOnlyDevicePacket,
    writeDevicePacket,
} from './siku-network';

class FakeDiscoverySocket extends EventEmitter {
    public broadcastEnabled = false;
    public readonly sentPackets: Array<{ payload: Buffer; port: number; address: string }> = [];
    public closed = false;

    public constructor(
        private readonly boundPort: number,
        private readonly onSend?: (socket: FakeDiscoverySocket, payload: Buffer, port: number, address: string) => void,
    ) {
        super();
    }

    public setBroadcast(flag: boolean): void {
        this.broadcastEnabled = flag;
    }

    public send(buffer: Buffer, port: number, address: string, callback: (error: Error | null) => void): void {
        this.sentPackets.push({ payload: Buffer.from(buffer), port, address });
        callback(null);
        this.onSend?.(this, Buffer.from(buffer), port, address);
    }

    public close(): void {
        this.closed = true;
    }

    public address(): AddressInfo {
        return {
            address: '0.0.0.0',
            family: 'IPv4',
            port: this.boundPort,
        };
    }
}

class FakeUnresponsiveRequestSocket extends EventEmitter {
    public readonly sentPackets: Array<{ payload: Buffer; port: number; address: string }> = [];
    public closed = false;

    public send(buffer: Buffer, port: number, address: string, callback: (error: Error | null) => void): void {
        this.sentPackets.push({ payload: Buffer.from(buffer), port, address });
        callback(null);
    }

    public close(): void {
        this.closed = true;
    }
}

describe('SIKU network helpers', () => {
    const discoveryResponseHex =
        'FDFD0210303031383030333534333533353330420006FE02B90E00FE107C30303138303033353433353335333042DD09';

    it('detects discovery self-echo packets and extracts discovery responses', () => {
        const discoveryPacket = buildDiscoveryPacket();
        const receivedAt = new Date('2026-04-17T00:00:00.000Z');

        expect(
            isDiscoverySelfEcho(
                discoveryPacket,
                { address: '192.168.55.51', port: 4000 },
                new Set(['192.168.55.51']),
                4000,
                discoveryPacket,
            ),
        ).to.equal(true);

        const device = parseDiscoveryResponse(
            Buffer.from(discoveryResponseHex, 'hex'),
            {
                address: '192.168.55.46',
                port: 4000,
            },
            receivedAt,
        );

        expect(device).to.deep.equal({
            host: '192.168.55.46',
            port: 4000,
            deviceId: '001800354353530B',
            deviceTypeCode: 14,
            deviceTypeHex: '0E00',
            receivedAt: '2026-04-17T00:00:00.000Z',
        });
    });

    it('normalizes lowercase discovery device ids to uppercase', () => {
        const response = buildPacket(
            '001800354353530b',
            '',
            SikuFunction.Response,
            Buffer.concat([
                Buffer.from([0xfe, 0x02, 0xb9, 0x0e, 0x00, 0xfe, 0x10, 0x7c]),
                Buffer.from('001800354353530b', 'ascii'),
            ]),
        );

        expect(parseDiscoveryResponse(response, { address: '192.168.55.46', port: 4000 })?.deviceId).to.equal(
            '001800354353530B',
        );
    });

    it('ignores discovery packets with invalid checksums, malformed packets or unexpected function codes', () => {
        const validPacket = Buffer.from(discoveryResponseHex, 'hex');
        const invalidChecksumPacket = Buffer.from(validPacket);
        invalidChecksumPacket[invalidChecksumPacket.length - 1] ^= 0xff;

        const nonResponsePacket = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Read,
            Buffer.from([0x7c, 0xb9]),
        );

        expect(
            parseDiscoveryResponse(invalidChecksumPacket, {
                address: '192.168.55.46',
                port: 4000,
            }),
        ).to.equal(null);
        expect(
            parseDiscoveryResponse(nonResponsePacket, {
                address: '192.168.55.46',
                port: 4000,
            }),
        ).to.equal(null);
        expect(
            parseDiscoveryResponse(Buffer.from('FDFD02', 'hex'), {
                address: '192.168.55.46',
                port: 4000,
            }),
        ).to.equal(null);

        const invalidDeviceIdPacket = buildPacket(
            Buffer.from('NOT-A-DEVICE-ID!', 'ascii'),
            '',
            SikuFunction.Response,
            Buffer.from([0xfe, 0x10, 0x7c, ...Buffer.from('NOT-A-DEVICE-ID!', 'ascii')]),
        );
        expect(
            parseDiscoveryResponse(invalidDeviceIdPacket, {
                address: '192.168.55.46',
                port: 4000,
            }),
        ).to.equal(null);
    });

    it('discovers devices through the injected UDP socket without keeping the local broadcast echo', async () => {
        const discoveryPacket = buildDiscoveryPacket();
        const fakeSocket = new FakeDiscoverySocket(4000, socket => {
            socket.emit('message', Buffer.from(discoveryPacket), {
                address: '192.168.55.51',
                family: 'IPv4',
                port: 4000,
                size: discoveryPacket.length,
            });
            socket.emit('message', Buffer.from(discoveryResponseHex, 'hex'), {
                address: '192.168.55.46',
                family: 'IPv4',
                port: 4000,
                size: discoveryResponseHex.length / 2,
            });
        });

        const devices = await discoverDevices(
            {
                broadcastAddress: '255.255.255.255',
                timeoutMs: 1,
                preferredBindPort: 4000,
            },
            {
                bindSocketWithFallback: () => Promise.resolve(fakeSocket),
                timer: () => Promise.resolve(),
                getLocalIPv4Addresses: () => new Set(['192.168.55.51']),
                now: () => new Date('2026-04-17T00:00:00.000Z'),
            },
        );

        expect(fakeSocket.broadcastEnabled).to.equal(true);
        expect(fakeSocket.closed).to.equal(true);
        expect(fakeSocket.sentPackets).to.have.length(1);
        expect(fakeSocket.sentPackets[0].address).to.equal('255.255.255.255');
        expect(devices).to.deep.equal([
            {
                host: '192.168.55.46',
                port: 4000,
                deviceId: '001800354353530B',
                deviceTypeCode: 14,
                deviceTypeHex: '0E00',
                receivedAt: '2026-04-17T00:00:00.000Z',
            },
        ]);
    });

    it('retries read requests after parse errors and returns the first valid response', async () => {
        const attemptResponses = [
            Buffer.from('FDFD02', 'hex'),
            buildPacket(
                Buffer.from('001800354353530B', 'ascii'),
                '1111',
                SikuFunction.Response,
                Buffer.from([0x01, 0x02]),
            ),
        ];
        const waitCalls: number[] = [];
        let callCount = 0;

        const packet = await readDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                parameters: [{ parameter: 0x0001 }],
            },
            {
                requestOnce: () => Promise.resolve(attemptResponses[callCount++]),
                timer: timeoutMs => {
                    waitCalls.push(timeoutMs);
                    return Promise.resolve();
                },
            },
        );

        expect(callCount).to.equal(2);
        expect(waitCalls).to.deep.equal([200]);
        expect(packet.entries).to.have.length(1);
        expect(packet.entries[0].parameter).to.equal(0x0001);
        expect(decodeUnsignedLE(packet.entries[0].value)).to.equal(0x02);
    });

    it('retries after a response with an invalid checksum', async () => {
        const invalidChecksumPacket = buildPacket(
            Buffer.from('001800354353530B', 'ascii'),
            '1111',
            SikuFunction.Response,
            Buffer.from([0x01, 0x02]),
        );
        invalidChecksumPacket[invalidChecksumPacket.length - 1] ^= 0xff;

        const attemptResponses = [
            invalidChecksumPacket,
            buildPacket(
                Buffer.from('001800354353530B', 'ascii'),
                '1111',
                SikuFunction.Response,
                Buffer.from([0x01, 0x02]),
            ),
        ];
        const waitCalls: number[] = [];
        let callCount = 0;

        const packet = await readDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                parameters: [{ parameter: 0x0001 }],
            },
            {
                requestOnce: () => Promise.resolve(attemptResponses[callCount++]),
                timer: timeoutMs => {
                    waitCalls.push(timeoutMs);
                    return Promise.resolve();
                },
            },
        );

        expect(callCount).to.equal(2);
        expect(waitCalls).to.deep.equal([200]);
        expect(packet.checksumValid).to.equal(true);
        expect(packet.functionCode).to.equal(SikuFunction.Response);
    });

    it('rejects stale responses with a different device id or parameter set', async () => {
        const responses = [
            buildPacket(
                Buffer.from('004500324353530B', 'ascii'),
                '1111',
                SikuFunction.Response,
                Buffer.from([0x01, 0x01]),
            ),
            buildPacket(
                Buffer.from('001800354353530B', 'ascii'),
                '1111',
                SikuFunction.Response,
                Buffer.from([0x02, 0x03]),
            ),
            buildPacket(
                Buffer.from('001800354353530B', 'ascii'),
                '1111',
                SikuFunction.Response,
                Buffer.from([0x01, 0x01]),
            ),
        ];
        const waits: number[] = [];
        let callCount = 0;

        const packet = await readDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                parameters: [{ parameter: 0x0001 }],
            },
            {
                requestOnce: () => Promise.resolve(responses[callCount++]),
                timer: delay => {
                    waits.push(delay);
                    return Promise.resolve();
                },
            },
        );

        expect(callCount).to.equal(3);
        expect(waits).to.deep.equal([200, 500]);
        expect(packet.deviceIdText).to.equal('001800354353530B');
        expect(packet.entries.map(entry => entry.parameter)).to.deep.equal([0x0001]);
    });

    it('sends W-only commands once with function 0x02 and without waiting for an echo', async () => {
        const sentPackets: Buffer[] = [];

        await sendWriteOnlyDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                parameters: [{ parameter: 0x0080, value: [0x01] }],
            },
            {
                sendOnce: (_host, _port, payload) => {
                    sentPackets.push(Buffer.from(payload));
                    return Promise.resolve();
                },
            },
        );

        expect(sentPackets).to.have.lengthOf(1);
        const packet = parsePacket(sentPackets[0]);
        expect(packet.functionCode).to.equal(SikuFunction.Write);
        expect(packet.entries.map(entry => entry.parameter)).to.deep.equal([0x0080]);
    });

    it('rejects unanswered UDP requests after the configured timeout and cleans up the socket', async () => {
        const fakeSocket = new FakeUnresponsiveRequestSocket();
        let thrownError: Error | undefined;

        try {
            await readDevicePacket(
                {
                    host: '127.0.0.1',
                    deviceId: '001800354353530B',
                    password: '1111',
                    port: 4000,
                    localPort: 0,
                    timeoutMs: 20,
                    retryDelaysMs: [0],
                    parameters: [{ parameter: 0x0001 }],
                },
                {
                    bindRequestSocket: () => Promise.resolve(fakeSocket),
                },
            );
        } catch (error) {
            thrownError = error as Error;
        }

        expect(fakeSocket.sentPackets).to.have.length(1);
        expect(fakeSocket.closed).to.equal(true);
        expect(thrownError?.message).to.equal('UDP request to 127.0.0.1:4000 timed out after 20 ms');
    });

    it('uses the target port as local request port by default for read and write traffic', async () => {
        const observedLocalPorts: number[] = [];

        await readDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                port: 4000,
                parameters: [{ parameter: 0x0001 }],
            },
            {
                requestOnce: (_host, _port, _payload, _timeoutMs, localPort) => {
                    observedLocalPorts.push(localPort);
                    return Promise.resolve(
                        buildPacket(
                            Buffer.from('001800354353530B', 'ascii'),
                            '1111',
                            SikuFunction.Response,
                            Buffer.from([0x01, 0x02]),
                        ),
                    );
                },
                timer: () => Promise.resolve(),
            },
        );

        await writeDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                port: 4000,
                parameters: [{ parameter: 0x006f, value: [3, 4, 5] }],
            },
            {
                requestOnce: (_host, _port, _payload, _timeoutMs, localPort) => {
                    observedLocalPorts.push(localPort);
                    return Promise.resolve(
                        buildPacket(
                            Buffer.from('001800354353530B', 'ascii'),
                            '1111',
                            SikuFunction.Response,
                            Buffer.from([0xfe, 0x03, 0x6f, 0x03, 0x04, 0x05]),
                        ),
                    );
                },
                timer: () => Promise.resolve(),
            },
        );

        expect(observedLocalPorts).to.deep.equal([4000, 4000]);
    });

    it('writes RTC values via function 0x03 and validates the response', async () => {
        const packet = await writeDevicePacket(
            {
                host: '192.168.55.46',
                deviceId: '001800354353530B',
                password: '1111',
                parameters: [
                    { parameter: 0x006f, value: [3, 4, 5] },
                    { parameter: 0x0070, value: [17, 5, 4, 26] },
                ],
            },
            {
                requestOnce: () =>
                    Promise.resolve(
                        buildPacket(
                            Buffer.from('001800354353530B', 'ascii'),
                            '1111',
                            SikuFunction.Response,
                            Buffer.from([0xfe, 0x03, 0x6f, 0x03, 0x04, 0x05, 0xfe, 0x04, 0x70, 0x11, 0x05, 0x04, 0x1a]),
                        ),
                    ),
                timer: () => Promise.resolve(),
            },
        );

        expect(packet.functionCode).to.equal(SikuFunction.Response);
        expect(packet.entries.map(entry => entry.parameter)).to.deep.equal([0x006f, 0x0070]);
    });

    it('rejects write responses that do not echo the requested values', async () => {
        let thrownError: Error | undefined;

        try {
            await writeDevicePacket(
                {
                    host: '192.168.55.46',
                    deviceId: '001800354353530B',
                    password: '1111',
                    parameters: [{ parameter: 0x006f, value: [3, 4, 5] }],
                },
                {
                    requestOnce: () =>
                        Promise.resolve(
                            buildPacket(
                                Buffer.from('001800354353530B', 'ascii'),
                                '1111',
                                SikuFunction.Response,
                                Buffer.from([0xfe, 0x03, 0x6f, 0x04, 0x04, 0x05]),
                            ),
                        ),
                    timer: () => Promise.resolve(),
                },
            );
        } catch (error) {
            thrownError = error as Error;
        }

        expect(thrownError?.message).to.equal('Write response mismatch for parameter 0x006f from 192.168.55.46');
    });

    it('throws the last network error once all retries are exhausted', async () => {
        const errors = [new Error('timeout #1'), new Error('timeout #2'), new Error('timeout #3')];
        const waitCalls: number[] = [];
        let callCount = 0;
        let thrownError: Error | undefined;

        try {
            await readDevicePacket(
                {
                    host: '192.168.55.46',
                    deviceId: '001800354353530B',
                    password: '1111',
                    parameters: [{ parameter: 0x0001 }],
                },
                {
                    requestOnce: () => Promise.reject(errors[callCount++]),
                    timer: timeoutMs => {
                        waitCalls.push(timeoutMs);
                        return Promise.resolve();
                    },
                },
            );
        } catch (error) {
            thrownError = error as Error;
        }

        expect(callCount).to.equal(3);
        expect(waitCalls).to.deep.equal([200, 500]);
        expect(thrownError?.message).to.equal('timeout #3');
    });
});
